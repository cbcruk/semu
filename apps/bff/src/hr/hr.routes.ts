import { LegacyError, legacyErrors } from '../legacy-error.ts'
import { etagFrom, json } from '../router.ts'
import type { Route, SignedInContext } from '../router.ts'
import { callApi, readJson } from '../upstream.ts'
import type { Employee, OrganizationUnit, Page } from '../upstream.types.ts'
import {
  countByStatus,
  drfPage,
  filterEmployees,
  organizationNames,
  parseEmployeeQuery,
  selectEmployees,
  toLegacyEmployee,
} from './hr.mapping.ts'
import type { OrganizationLookup } from './hr.mapping.ts'

const BASE = '/api/company/:companyId/employment/wage-employees'

/** 새 API가 한 번에 주는 최대 직원 수입니다. */
const UPSTREAM_PAGE_SIZE = 200

/**
 * 근로소득자 전체를 읽습니다. 현행 `limit/offset`·건수·탭 집계를 커서 목록으로 흉내 낼 수 없어 끝까지 읽고 BFF에서 자릅니다.
 * 회사 하나의 직원 수(수백 명)에서는 감당할 만하고, 화면을 새 API로 옮기면 사라집니다.
 *
 * 끝없이 돌지 않게 `maxUpstreamPages`쪽에서 멈추고, 같은 커서가 다시 오면 바로 멈춥니다. 둘 다 502입니다.
 */
export async function allWageEmployees({ deps, sessionId, params }: SignedInContext): Promise<Employee[]> {
  const employees: Employee[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let pages = 0; ; pages += 1) {
    if (pages >= deps.maxUpstreamPages) {
      throw new LegacyError(502, {
        detail: `The employee list has more than ${deps.maxUpstreamPages * UPSTREAM_PAGE_SIZE} rows; use the new API.`,
        code: 'UPSTREAM_LIST_TOO_LARGE',
      })
    }
    const query = new URLSearchParams({ kind: 'WAGE', limit: String(UPSTREAM_PAGE_SIZE) })
    if (cursor !== undefined) query.set('cursor', cursor)
    const page = await readJson<Page<Employee>>(
      await callApi(deps, sessionId, params['companyId'], 'GET', `/v1/employees?${query}`),
    )
    employees.push(...page.items)
    cursor = page.nextCursor
    if (cursor === undefined) return employees
    if (seen.has(cursor)) {
      throw new LegacyError(502, {
        detail: 'The upstream API returned a cursor it had already returned.',
        code: 'UPSTREAM_CURSOR_REPEATED',
      })
    }
    seen.add(cursor)
  }
}

/** 부서·직위 이름표를 읽습니다. 현행 응답의 `department_name`, `position_name`을 채웁니다. */
async function organization(context: SignedInContext): Promise<OrganizationLookup> {
  const { deps, sessionId, params } = context
  const read = async (path: string) =>
    organizationNames(
      (await readJson<{ items: OrganizationUnit[] }>(await callApi(deps, sessionId, params['companyId'], 'GET', path)))
        .items,
    )
  const [departments, positions] = await Promise.all([read('/v1/departments'), read('/v1/positions')])
  return { departments, positions }
}

/**
 * 구성원 정보(근로소득자) 목록·탭 건수·상세입니다.
 *
 * | 현행 | 새 API |
 * |---|---|
 * | `GET …/employment/wage-employees/` | `GET /v1/employees?kind=WAGE` (끝까지), `GET /v1/departments`, `GET /v1/positions` |
 * | `GET …/employment/wage-employees/count-by-status/` | `GET /v1/employees?kind=WAGE` (끝까지) |
 * | `GET …/employment/wage-employees/:employeeId/` | `GET /v1/employees/{employeeId}`, 부서·직위 |
 */
export const hrRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: BASE,
    auth: true,
    handle: async (context) => {
      const query = parseEmployeeQuery(context.url.searchParams)
      const employees = await allWageEmployees(context)
      const names = await organization(context)
      const rows = selectEmployees(filterEmployees(employees, query, names), query, names)
      const page = drfPage(rows, query, context.url, context.deps.publicBaseUrl)
      return json({
        ...page,
        results: page.results.map((row) => toLegacyEmployee(row, names.departments, names.positions)),
      })
    },
  },
  {
    method: 'GET',
    path: `${BASE}/count-by-status`,
    auth: true,
    handle: async (context) => {
      const query = parseEmployeeQuery(context.url.searchParams)
      const employees = await allWageEmployees(context)
      return json(countByStatus(filterEmployees(employees, query, await organization(context))))
    },
  },
  {
    method: 'GET',
    path: `${BASE}/:employeeId`,
    auth: true,
    handle: async (context) => {
      const { deps, sessionId, params } = context
      const response = await callApi(
        deps,
        sessionId,
        params['companyId'],
        'GET',
        `/v1/employees/${encodeURIComponent(params['employeeId'] ?? '')}`,
      )
      // 경로의 ID가 새 ID 형식이 아니면 새 API는 400입니다. 현행은 그런 경로가 없어 404였습니다.
      if (response.status === 400) throw legacyErrors.notFound('Employee')
      const employee = await readJson<Employee>(response)
      // 현행 경로는 근로소득자만 받았습니다. 다른 종류는 `daily-employees` 같은 다른 경로였습니다.
      if (employee.kind !== 'WAGE') throw legacyErrors.notFound('Employee')
      const { departments, positions } = await organization(context)
      return json(toLegacyEmployee(employee, departments, positions), 200, etagFrom(response))
    },
  },
]
