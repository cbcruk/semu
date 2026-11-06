import { snakeCase, snakeCasePath, transformKeys } from './keys.ts'

/**
 * 현행 오류 본문입니다. DRF식 `{ detail, code }`에 필드 오류(`errors`)와 코드별 추가 필드가 붙습니다.
 *
 * @example
 * ```json
 * { "detail": "Request validation failed.", "code": "VALIDATION_FAILED", "errors": { "status": ["Unknown status."] } }
 * ```
 */
export interface LegacyErrorBody {
  detail: string
  code: string
  errors?: Record<string, string[]>
  [extra: string]: unknown
}

/** 현행 형태로 응답할 실패입니다. 라우트가 던지면 앱이 응답으로 바꿉니다. */
export class LegacyError extends Error {
  readonly status: number
  readonly body: LegacyErrorBody
  /** 참이면 BFF 세션이 끝났으므로 응답에서 세션·CSRF 쿠키를 지웁니다. */
  readonly endsSession: boolean

  constructor(status: number, body: LegacyErrorBody, options: { endsSession?: boolean } = {}) {
    super(body.detail)
    this.name = 'LegacyError'
    this.status = status
    this.body = body
    this.endsSession = options.endsSession ?? false
  }

  /** 응답으로 바꿉니다. 세션이 끝났으면 쿠키를 지우는 헤더를 함께 넣습니다. */
  toResponse(headers?: Headers): Response {
    const merged = new Headers(headers)
    merged.set('content-type', 'application/json')
    return new Response(JSON.stringify(this.body), { status: this.status, headers: merged })
  }
}

/** 자주 쓰는 현행 오류입니다. 문구는 현행 서버와 같습니다. */
export const legacyErrors = {
  unauthenticated: (options: { endsSession?: boolean } = {}) =>
    new LegacyError(
      401,
      { detail: 'Authentication credentials were not provided or are invalid.', code: 'UNAUTHENTICATED' },
      options,
    ),
  csrfFailed: () => new LegacyError(403, { detail: 'CSRF token missing or incorrect.', code: 'CSRF_FAILED' }),
  notFound: (resource = '') =>
    new LegacyError(404, { detail: resource === '' ? 'Not found.' : `${resource} not found.`, code: 'NOT_FOUND' }),
  invalidField: (field: string, message: string) =>
    new LegacyError(422, {
      detail: 'Request validation failed.',
      code: 'VALIDATION_FAILED',
      errors: { [field]: [message] },
    }),
  internal: () => new LegacyError(500, { detail: 'Internal server error.', code: 'INTERNAL_ERROR' }),
  preconditionRequired: (resource: string) =>
    new LegacyError(428, {
      detail: `Send If-Match with the ${resource} version to change its status.`,
      code: 'PRECONDITION_REQUIRED',
    }),
  staleVersion: (resource: string) =>
    new LegacyError(412, {
      detail: `The ${resource} was changed by someone else. Reload and try again.`,
      code: 'VERSION_CONFLICT',
    }),
}

/** 새 API 문제 코드 → 현행 코드·상태입니다. 여기 없는 코드는 아래 접미사 규칙과 기본값을 따릅니다. */
const CODE_MAP: Record<string, { code: string; status: number }> = {
  UNAUTHENTICATED: { code: 'UNAUTHENTICATED', status: 401 },
  SESSION_INVALID: { code: 'UNAUTHENTICATED', status: 401 },
  INVALID_CREDENTIALS: { code: 'INVALID_CREDENTIALS', status: 401 },
  PERMISSION_DENIED: { code: 'PERMISSION_DENIED', status: 403 },
  ENTITLEMENT_REQUIRED: { code: 'ENTITLEMENT_REQUIRED', status: 403 },
  TERMS_REAGREEMENT_REQUIRED: { code: 'TAX_TERMS_REQUIRED', status: 403 },
  DEMO_READ_ONLY: { code: 'DEMO_READ_ONLY', status: 403 },
  VALIDATION_FAILED: { code: 'VALIDATION_FAILED', status: 422 },
  VERSION_MISMATCH: { code: 'VERSION_CONFLICT', status: 412 },
  IDEMPOTENCY_KEY_REQUIRED: { code: 'PRECONDITION_REQUIRED', status: 428 },
  // 업무 규칙 위반도 현행은 필드 오류(422 `VALIDATION_FAILED` + `errors`)였습니다.
  LEAVE_INVALID: { code: 'VALIDATION_FAILED', status: 422 },
  WORK_CONTRACT_INVALID: { code: 'VALIDATION_FAILED', status: 422 },
  PAYROLL_CONTRACT_INVALID: { code: 'VALIDATION_FAILED', status: 422 },
  // 현행 HR 오류 코드는 같고 상태만 400이었습니다.
  LEAVE_OVERLAP: { code: 'LEAVE_OVERLAP', status: 400 },
  RETIREMENT_COMPLETED: { code: 'RETIREMENT_COMPLETED', status: 400 },
  // 현행 급여카드 오류입니다. 입력을 고칠 수 없는 상태는 현행도 409 `INVALID_TRANSITION`이었습니다.
  PAYROLL_LEDGER_READ_ONLY: { code: 'INVALID_TRANSITION', status: 409 },
  ADDITIONAL_LEDGER_BLOCKED: { code: 'ADDITIONAL_CARD_NOT_ALLOWED', status: 409 },
  WAGE_ROW_ON_ADDITIONAL_LEDGER: { code: 'WAGE_INCOME_ON_ADDITIONAL_CARD', status: 409 },
  // 이름은 `_NOT_FOUND`로 끝나지만 경로의 리소스가 없는 게 아니라 귀속월의 기준표가 없는 422입니다.
  RATE_TABLE_NOT_FOUND: { code: 'RATE_TABLE_NOT_FOUND', status: 422 },
  INTERNAL: { code: 'INTERNAL_ERROR', status: 500 },
}

/** 접미사로 묶는 코드입니다. `EMPLOYEE_NOT_FOUND` → `NOT_FOUND` 처럼 현행의 넓은 코드로 모읍니다. */
const SUFFIX_MAP: ReadonlyArray<readonly [string, { code: string; status: number }]> = [
  ['_NOT_FOUND', { code: 'NOT_FOUND', status: 404 }],
  ['_DUPLICATE', { code: 'CONFLICT', status: 409 }],
  ['_ALREADY_REGISTERED', { code: 'CONFLICT', status: 409 }],
  ['_TRANSITION_INVALID', { code: 'INVALID_TRANSITION', status: 409 }],
]

/** 문제 본문에서 현행 본문으로 옮기지 않는 필드입니다. */
const PROBLEM_FIELDS = new Set(['type', 'title', 'status', 'code', 'detail', 'violations', 'instance'])

/** 위반 코드 → 현행 필드 오류 문구입니다. */
const VIOLATION_MESSAGES: Record<string, string> = {
  REQUIRED: 'This field is required.',
  INVALID_TYPE: 'Invalid type.',
  INVALID_VALUE: 'Invalid value.',
}

/** 요청 부분 전체가 잘못됐을 때 쓰는 새 API의 필드 이름입니다. 현행은 DRF처럼 `non_field_errors`에 담았습니다. */
const WHOLE_PART_FIELDS = new Set(['path', 'query', 'headers', 'body'])

/**
 * 새 API의 RFC 9457 문제를 현행 오류로 바꿉니다.
 *
 * - `code`는 {@link CODE_MAP}, 접미사 규칙 순으로 바꾸고, 어디에도 없으면 그대로 둡니다(이미 영문 대문자 상수입니다)
 * - `detail`은 새 `detail`, 없으면 `title`에 마침표를 붙여 씁니다
 * - `violations[]`는 필드별 문자열 배열 `errors`로 바꾸고, 필드 경로를 snake_case로 바꿉니다
 * - 나머지 추가 필드(`duplicateEmployeeId`, `requiredPlans`)는 키만 snake_case로 바꿔 붙입니다
 */
export function fromProblem(status: number, problem: unknown): LegacyError {
  const body = typeof problem === 'object' && problem !== null ? (problem as Record<string, unknown>) : {}
  const sourceCode = typeof body['code'] === 'string' ? body['code'] : undefined
  const mapped = mapCode(sourceCode, status)
  const title = typeof body['title'] === 'string' ? body['title'] : 'Request failed'
  const detail = typeof body['detail'] === 'string' ? body['detail'] : `${title.replace(/\.$/, '')}.`
  const legacy: LegacyErrorBody = { detail, code: mapped.code }
  const errors = toFieldErrors(body['violations'])
  if (errors !== undefined) legacy.errors = errors
  for (const [key, value] of Object.entries(body)) {
    if (PROBLEM_FIELDS.has(key)) continue
    legacy[snakeCase(key)] = transformKeys(value, snakeCase)
  }
  if (mapped.code === 'ENTITLEMENT_REQUIRED' && !('promotion_url' in legacy)) legacy['promotion_url'] = null
  return new LegacyError(mapped.status, legacy)
}

function mapCode(code: string | undefined, status: number): { code: string; status: number } {
  if (code === undefined) return { code: status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR', status }
  const direct = CODE_MAP[code]
  if (direct !== undefined) return direct
  for (const [suffix, target] of SUFFIX_MAP) if (code.endsWith(suffix)) return target
  return { code, status }
}

function toFieldErrors(violations: unknown): Record<string, string[]> | undefined {
  if (!Array.isArray(violations) || violations.length === 0) return undefined
  const errors: Record<string, string[]> = {}
  for (const violation of violations) {
    if (typeof violation !== 'object' || violation === null) continue
    const { field, code } = violation as { field?: unknown; code?: unknown }
    const name = typeof field !== 'string' || WHOLE_PART_FIELDS.has(field) ? 'non_field_errors' : snakeCasePath(field)
    const message = typeof code === 'string' ? (VIOLATION_MESSAGES[code] ?? code) : 'Invalid value.'
    ;(errors[name] ??= []).push(message)
  }
  return errors
}

/**
 * 필드 오류의 이름을 현행 이름으로 바꿉니다. 새 API는 중첩 필드(`paid.allowance`)를 쓰고 현행은 평평한 필드(`paid_allowance`)를 썼습니다.
 * 필드 오류가 없거나 표에 없는 이름이면 그대로 둡니다.
 *
 * @param rename snake_case로 바꾼 새 API 필드 경로 → 현행 필드 이름
 */
export function renameFieldErrors(error: LegacyError, rename: (field: string) => string): LegacyError {
  const errors = error.body.errors
  if (errors === undefined) return error
  const renamed: Record<string, string[]> = {}
  for (const [field, messages] of Object.entries(errors)) (renamed[rename(field)] ??= []).push(...messages)
  return new LegacyError(error.status, { ...error.body, errors: renamed }, { endsSession: error.endsSession })
}
