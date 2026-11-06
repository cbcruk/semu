import { readObject } from '../legacy-body.ts'
import { LegacyError, legacyErrors } from '../legacy-error.ts'
import { json } from '../router.ts'
import type { Route, SignedInContext } from '../router.ts'
import type { Leave, LeaveSummary } from '../upstream.types.ts'
import {
  assertEmployeeVersion,
  EMPLOYEE_BASE,
  etagHeader,
  expectNoContent,
  newestFirst,
  read,
  requireIfMatch,
  segment,
  upstream,
  versionTag,
  wageEmployee,
} from './employee-scope.ts'
import type { WageEmployee } from './employee-scope.ts'
import { drfPage, pageOf } from './hr.mapping.ts'
import {
  assertReturnDateInRange,
  changesBesidesReturn,
  fromLegacyLeave,
  leaveField,
  toLegacyLeave,
  toLegacyLeaveSummary,
} from './leaves.mapping.ts'

const BASE = `${EMPLOYEE_BASE}/leave-of-absences`

interface EmployeeLeaves extends WageEmployee {
  leaves: Leave[]
  summary: LeaveSummary
}

/** 직원과 그 휴직 전체·요약을 함께 읽습니다. 현행 휴직 응답의 `ETag`는 직원 버전입니다. */
async function employeeLeaves(context: SignedInContext): Promise<EmployeeLeaves> {
  const [list, scope] = await Promise.all([
    upstream(context, 'GET', `/v1/employees/${segment(context, 'employeeId')}/leaves`).then((response) =>
      read<{ items: Leave[]; summary: LeaveSummary }>(response, { notFound: 'Employee' }),
    ),
    wageEmployee(context),
  ])
  return { ...scope, leaves: newestFirst(list.items), summary: list.summary }
}

function findLeave(context: SignedInContext, leaves: readonly Leave[]): Leave {
  const leave = leaves.find((candidate) => candidate.id === context.params['leaveId'])
  if (leave === undefined) throw legacyErrors.notFound('Leave of absence')
  return leave
}

/** 복직을 기록합니다. 휴직 버전으로 다른 요청의 변경을 덮어쓰지 않습니다. */
async function recordReturn(context: SignedInContext, leave: Leave, actualReturnDate: string): Promise<Leave> {
  return read<Leave>(
    await upstream(context, 'POST', `/v1/leaves/${encodeURIComponent(leave.id)}:return`, {
      body: { actualReturnDate },
      headers: { 'if-match': versionTag(leave.version) },
    }),
    { rename: leaveField },
  )
}

/**
 * 등록 뒤 복직 기록이 실패했을 때 처리합니다. 현행은 등록과 복직이 한 트랜잭션이었습니다.
 *
 * - 새 API가 분명히 거절했으면(4xx) 방금 만든 휴직을 지워 되돌리고 그 거절을 돌려줍니다
 * - 결과를 모르면(시간 초과·연결 실패·5xx) 복직이 이미 기록됐을 수 있으므로 지우지 않습니다. 지우면 복직 신고만 남을 수
 *   있습니다. 클라이언트에는 다시 읽으라는 오류를 줍니다
 * - 되돌리기가 실패하면 로그를 남기고(휴직 ID와 상태만) 다시 읽으라는 오류를 줍니다
 *
 * @returns 던질 오류
 */
async function undoLeave(context: SignedInContext, leave: Leave, error: unknown): Promise<unknown> {
  const reload = (status: number) =>
    new LegacyError(status, {
      detail:
        'The leave was registered but its return date may not be recorded. Reload the leave list before retrying.',
      code: 'PARTIAL_WRITE',
    })
  if (!(error instanceof LegacyError) || error.status >= 500)
    return reload(error instanceof LegacyError ? error.status : 502)
  const undone = await upstream(context, 'DELETE', `/v1/leaves/${encodeURIComponent(leave.id)}`).catch(
    (failure: unknown) => failure,
  )
  if (undone instanceof Response && undone.ok) return error
  console.error('BFF: undoing a leave after a rejected return date failed', {
    leaveId: leave.id,
    status: undone instanceof Response ? undone.status : undone instanceof LegacyError ? undone.status : undefined,
  })
  return reload(502)
}

/** 현행 `PUT`이 새 API로 옮길 수 없는 변경을 담았을 때입니다. */
function unsupportedEdit(): LegacyError {
  return legacyErrors.invalidField(
    'non_field_errors',
    'Only the actual return date can be added to a leave. Delete the leave and register it again to change it.',
  )
}

/**
 * 휴직 요약·목록·상세·등록·수정·삭제입니다.
 *
 * | 현행 | 새 API |
 * |---|---|
 * | `GET …/:employeeId/leave-of-absence-info/` | `GET /v1/employees/{id}/leaves`의 `summary` |
 * | `GET …/:employeeId/leave-of-absences/`, `…/:leaveId/` | `GET /v1/employees/{id}/leaves` |
 * | `POST …/:employeeId/leave-of-absences/` | `POST /v1/employees/{id}/leaves` (+ 복직일이 있으면 `POST /v1/leaves/{id}:return`) |
 * | `PUT …/:employeeId/leave-of-absences/:leaveId/` | 복직일을 처음 넣을 때만 `POST /v1/leaves/{id}:return` |
 * | `DELETE …/:employeeId/leave-of-absences/:leaveId/` | `DELETE /v1/leaves/{id}` |
 *
 * 현행 쓰기는 직원 버전(`If-Match`)을 요구했습니다. 새 API의 휴직 쓰기는 직원 버전을 보지 않고 올리지도 않으므로,
 * BFF가 지금 직원 버전과 비교하고(없으면 428, 다르면 412) 응답의 `ETag`도 그 버전 그대로 줍니다.
 */
export const leaveRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: `${EMPLOYEE_BASE}/leave-of-absence-info`,
    auth: true,
    handle: async (context) => {
      const { leaves, summary, etag } = await employeeLeaves(context)
      return json(toLegacyLeaveSummary(summary, leaves), 200, etagHeader(etag))
    },
  },
  {
    method: 'GET',
    path: BASE,
    auth: true,
    handle: async (context) => {
      const { leaves, etag } = await employeeLeaves(context)
      const page = drfPage(leaves, pageOf(context.url.searchParams), context.url, context.deps.publicBaseUrl)
      return json({ ...page, results: page.results.map(toLegacyLeave) }, 200, etagHeader(etag))
    },
  },
  {
    method: 'GET',
    path: `${BASE}/:leaveId`,
    auth: true,
    handle: async (context) => {
      const { leaves, etag } = await employeeLeaves(context)
      return json(toLegacyLeave(findLeave(context, leaves)), 200, etagHeader(etag))
    },
  },
  {
    method: 'POST',
    path: BASE,
    auth: true,
    handle: async (context) => {
      const ifMatch = requireIfMatch(context.request)
      const request = fromLegacyLeave(await readObject(context.request))
      if (request.actualReturnDate !== null) assertReturnDateInRange(request.create, request.actualReturnDate)
      const { employee, etag } = await wageEmployee(context)
      assertEmployeeVersion(employee, ifMatch)
      let leave = await read<Leave>(
        await upstream(context, 'POST', `/v1/employees/${encodeURIComponent(employee.id)}/leaves`, {
          body: request.create,
        }),
        { rename: leaveField },
      )
      if (request.actualReturnDate !== null) {
        try {
          leave = await recordReturn(context, leave, request.actualReturnDate)
        } catch (error) {
          throw await undoLeave(context, leave, error)
        }
      }
      return json(toLegacyLeave(leave), 201, etagHeader(etag))
    },
  },
  {
    method: 'PUT',
    path: `${BASE}/:leaveId`,
    auth: true,
    handle: async (context) => {
      const ifMatch = requireIfMatch(context.request)
      const request = fromLegacyLeave(await readObject(context.request))
      const { employee, leaves, etag } = await employeeLeaves(context)
      assertEmployeeVersion(employee, ifMatch)
      const current = findLeave(context, leaves)
      if (changesBesidesReturn(current, request.create)) throw unsupportedEdit()
      const next = request.actualReturnDate
      if (next === (current.actualReturnDate ?? null)) return json(toLegacyLeave(current), 200, etagHeader(etag))
      // 복직을 고치거나 지우는 커맨드는 새 API에 없습니다.
      if (next === null || current.actualReturnDate !== undefined) throw unsupportedEdit()
      return json(toLegacyLeave(await recordReturn(context, current, next)), 200, etagHeader(etag))
    },
  },
  {
    method: 'DELETE',
    path: `${BASE}/:leaveId`,
    auth: true,
    handle: async (context) => {
      const ifMatch = requireIfMatch(context.request)
      const { employee, leaves, etag } = await employeeLeaves(context)
      assertEmployeeVersion(employee, ifMatch)
      const leave = findLeave(context, leaves)
      await expectNoContent(await upstream(context, 'DELETE', `/v1/leaves/${encodeURIComponent(leave.id)}`))
      return new Response(null, { status: 204, headers: etagHeader(etag) })
    },
  },
]
