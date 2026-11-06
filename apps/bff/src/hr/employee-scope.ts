import { LegacyError, legacyErrors, renameFieldErrors } from '../legacy-error.ts'
import type { SignedInContext } from '../router.ts'
import { callApi, readJson } from '../upstream.ts'
import type { Employee } from '../upstream.types.ts'

/**
 * 인사 하위 리소스(계약·휴직·퇴직) 라우트가 같이 쓰는 도우미입니다.
 *
 * 현행 경로는 모두 `/api/company/:companyId/employment/wage-employees/:employeeId/…` 아래에 있고, 근로소득자만 받았습니다.
 */

/** 현행 근로소득자 하나의 경로입니다. */
export const EMPLOYEE_BASE = '/api/company/:companyId/employment/wage-employees/:employeeId'

/** 경로의 회사로 새 API를 부릅니다. */
export function upstream(
  context: SignedInContext,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  return callApi(context.deps, context.sessionId, context.params['companyId'], method, path, options)
}

/** 경로 변수를 새 API 경로 조각으로 씁니다. */
export function segment(context: SignedInContext, name: string): string {
  return encodeURIComponent(context.params[name] ?? '')
}

/**
 * 성공 본문을 읽고, 실패면 현행 오류로 바꿔 던집니다. 필드 오류 이름은 `rename`으로 현행 이름으로 바꿉니다.
 *
 * 경로의 ID가 새 ID 형식이 아니면 새 API는 400입니다. 현행은 그런 경로가 없어 404였으므로 `notFound`가 있으면 404로 바꿉니다.
 */
export async function read<A>(
  response: Response,
  options: { rename?: (field: string) => string; notFound?: string } = {},
): Promise<A> {
  if (response.status === 400 && options.notFound !== undefined) throw legacyErrors.notFound(options.notFound)
  try {
    return await readJson<A>(response)
  } catch (error) {
    if (error instanceof LegacyError && options.rename !== undefined) throw renameFieldErrors(error, options.rename)
    throw error
  }
}

/** 응답 없이 성공만 확인합니다(`204`). */
export async function expectNoContent(response: Response, options: { notFound?: string } = {}): Promise<void> {
  if (response.ok) return
  await read(response, options)
}

/** 경로의 근로소득자와 그 `ETag`입니다. */
export interface WageEmployee {
  employee: Employee
  etag: string
}

/**
 * 경로의 직원을 읽습니다. 현행 경로는 근로소득자만 받았으므로 다른 종류는 404입니다.
 *
 * 현행 휴직·퇴직 응답의 `ETag`는 직원 버전이었으므로 같이 돌려줍니다.
 */
export async function wageEmployee(context: SignedInContext): Promise<WageEmployee> {
  const response = await upstream(context, 'GET', `/v1/employees/${segment(context, 'employeeId')}`)
  const employee = await read<Employee>(response, { notFound: 'Employee' })
  if (employee.kind !== 'WAGE') throw legacyErrors.notFound('Employee')
  return { employee, etag: response.headers.get('etag') ?? versionTag(employee.version) }
}

/** 버전을 `ETag` 값으로 씁니다. */
export function versionTag(version: number): string {
  return `"${version}"`
}

/** `ETag` 헤더 하나입니다. */
export function etagHeader(etag: string): Headers {
  return new Headers({ etag })
}

const VERSION_TAG = /^(?:W\/)?"?(\d+)"?$/

/**
 * 현행 `If-Match`(직원 버전)를 읽습니다. 현행 서버처럼 없으면 428, 형식이 틀리면 412입니다.
 *
 * @returns 받은 헤더 값 그대로. 새 API에 그대로 넘깁니다.
 */
export function requireIfMatch(request: Request): string {
  const header = optionalIfMatch(request)
  if (header === undefined) throw legacyErrors.preconditionRequired('employee')
  return header
}

/** `If-Match`가 있으면 읽고 형식을 확인합니다. */
export function optionalIfMatch(request: Request): string | undefined {
  const header = request.headers.get('if-match')
  if (header === null) return undefined
  const trimmed = header.trim()
  if (!VERSION_TAG.test(trimmed)) {
    throw new LegacyError(412, { detail: 'If-Match must carry a version such as "3".', code: 'VERSION_CONFLICT' })
  }
  return trimmed
}

/**
 * `If-Match`의 직원 버전이 지금 버전과 같은지 봅니다. 새 API가 버전을 보지 않는 쓰기(휴직)에서 현행 동시성 검사를 흉내 냅니다.
 *
 * @throws {LegacyError} 412 `VERSION_CONFLICT`
 */
export function assertEmployeeVersion(employee: Employee, ifMatch: string): void {
  const version = Number(VERSION_TAG.exec(ifMatch)?.[1])
  if (version !== employee.version) throw legacyErrors.staleVersion('employee')
}

/** 현행 목록 순서(시작일 내림차순, 같으면 ID 내림차순)로 정렬합니다. 새 ID는 만든 순서대로 커집니다. */
export function newestFirst<A extends { id: string; startDate: string }>(rows: readonly A[]): A[] {
  return [...rows].sort((a, b) =>
    a.startDate === b.startDate ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.startDate < b.startDate ? 1 : -1,
  )
}
