import { readObject } from '../legacy-body.ts'
import { etagFrom, json } from '../router.ts'
import type { Route, SignedInContext } from '../router.ts'
import type { Employee } from '../upstream.types.ts'
import {
  assertEmployeeVersion,
  EMPLOYEE_BASE,
  etagHeader,
  optionalIfMatch,
  read,
  requireIfMatch,
  upstream,
  wageEmployee,
} from './employee-scope.ts'
import { retirementChange, toLegacyResignationError, toLegacyRetirement } from './retirement.mapping.ts'

const PATH = `${EMPLOYEE_BASE}/retirement-info`

/**
 * 직원 커맨드(`:resign`, `:cancel-resignation`)를 보냅니다. 새 API도 직원 버전을 보므로 `If-Match`를 그대로 넘깁니다.
 *
 * @returns 바뀐 직원과 새 `ETag`가 담긴 응답
 */
async function command(
  context: SignedInContext,
  employee: Employee,
  name: 'resign' | 'cancel-resignation',
  ifMatch: string | undefined,
  body?: unknown,
): Promise<{ employee: Employee; response: Response }> {
  const response = await upstream(context, 'POST', `/v1/employees/${encodeURIComponent(employee.id)}:${name}`, {
    ...(body === undefined ? {} : { body }),
    ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } }),
  })
  try {
    return { employee: await read<Employee>(response), response }
  } catch (error) {
    throw toLegacyResignationError(error)
  }
}

/**
 * 퇴직 정보 조회·저장·퇴직 취소입니다.
 *
 * | 현행 | 새 API |
 * |---|---|
 * | `GET …/:employeeId/retirement-info/` | `GET /v1/employees/{id}`의 `resignation`, `severanceSettlementStatus` |
 * | `PUT …/:employeeId/retirement-info/` (퇴직일 있음) | `POST /v1/employees/{id}:resign` |
 * | `PUT …/:employeeId/retirement-info/` (퇴직일을 지움), `DELETE …/retirement-info/` | `POST /v1/employees/{id}:cancel-resignation` |
 *
 * 현행처럼 퇴직일이 바뀌는 쓰기만 `If-Match`(직원 버전)를 요구하고(없으면 428), 사유만 고칠 때는 있으면 넘깁니다.
 */
export const retirementRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: PATH,
    auth: true,
    handle: async (context) => {
      const { employee, etag } = await wageEmployee(context)
      return json(toLegacyRetirement(employee), 200, etagHeader(etag))
    },
  },
  {
    method: 'PUT',
    path: PATH,
    auth: true,
    handle: async (context) => {
      const sentIfMatch = optionalIfMatch(context.request)
      const body = await readObject(context.request)
      const { employee, etag } = await wageEmployee(context)
      const change = retirementChange(employee, body)
      if (change.kind === 'none') return json(toLegacyRetirement(employee), 200, etagHeader(etag))
      const ifMatch =
        change.kind === 'cancel' || change.leaveDateChanged ? requireIfMatch(context.request) : sentIfMatch
      const result =
        change.kind === 'cancel'
          ? await command(context, employee, 'cancel-resignation', ifMatch)
          : await command(context, employee, 'resign', ifMatch, change.resignation)
      return json(toLegacyRetirement(result.employee), 200, etagFrom(result.response))
    },
  },
  {
    method: 'DELETE',
    path: PATH,
    auth: true,
    handle: async (context) => {
      const ifMatch = requireIfMatch(context.request)
      const { employee, etag } = await wageEmployee(context)
      if (employee.resignation === undefined) {
        // 현행은 퇴직이 없어도 지우는 데 성공했습니다. 새 API의 취소는 퇴직이 없으면 거절하므로 버전만 확인합니다.
        assertEmployeeVersion(employee, ifMatch)
        return new Response(null, { status: 204, headers: etagHeader(etag) })
      }
      const { response } = await command(context, employee, 'cancel-resignation', ifMatch)
      return new Response(null, { status: 204, headers: etagFrom(response) })
    },
  },
]
