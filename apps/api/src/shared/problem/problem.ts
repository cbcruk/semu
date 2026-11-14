import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'

/** 오류 코드로 `type` URI를 만듭니다. 예: `urn:semu:problem:slot-full` */
export function problemType(code: string): string {
  return `urn:semu:problem:${code.toLowerCase().replaceAll('_', '-')}`
}

/** 요청 경로와 메서드에 맞는 경로가 없습니다. */
export class NotFound extends HttpApiError.Problem<NotFound>()(
  'NotFound',
  { type: problemType('NOT_FOUND'), status: 404, title: 'Resource not found' },
  { code: Schema.tag('NOT_FOUND') },
) {}

/** 핸들러가 선언하지 않은 예상 밖의 실패입니다. */
export class Internal extends HttpApiError.Problem<Internal>()(
  'Internal',
  { type: problemType('INTERNAL'), status: 500, title: 'Internal server error' },
  { code: Schema.tag('INTERNAL') },
) {}

/** 요청 경로·쿼리·헤더·본문이 스키마를 통과하지 못했습니다. */
export class ValidationFailed extends HttpApiError.Problem<ValidationFailed>()(
  'ValidationFailed',
  { type: problemType('VALIDATION_FAILED'), status: 400, title: 'Request validation failed' },
  {
    code: Schema.tag('VALIDATION_FAILED'),
    violations: Schema.Array(Schema.Struct({ field: Schema.String, code: Schema.String })),
  },
) {}

/** 본문의 `Content-Type`이 그 경로의 계약에 없습니다. 받는 형식은 OpenAPI 문서의 요청 본문에 있습니다. */
export class UnsupportedMediaType extends HttpApiError.Problem<UnsupportedMediaType>()(
  'UnsupportedMediaType',
  { type: problemType('UNSUPPORTED_MEDIA_TYPE'), status: 415, title: 'Unsupported content type' },
  { code: Schema.tag('UNSUPPORTED_MEDIA_TYPE') },
) {}

/** `If-Match`로 보낸 버전이 저장된 버전과 다릅니다. 다른 사람이 먼저 고쳤습니다. */
export class VersionMismatch extends HttpApiError.Problem<VersionMismatch>()(
  'VersionMismatch',
  { type: problemType('VERSION_MISMATCH'), status: 412, title: 'Resource was changed by someone else' },
  { code: Schema.tag('VERSION_MISMATCH'), currentVersion: Schema.Int },
) {}

/** 인증 정보가 없거나 만료됐습니다. */
export class Unauthenticated extends HttpApiError.Problem<Unauthenticated>()(
  'Unauthenticated',
  { type: problemType('UNAUTHENTICATED'), status: 401, title: 'Authentication required' },
  { code: Schema.tag('UNAUTHENTICATED') },
) {}

/**
 * 토큰은 유효하지만 이 경로가 받는 범위가 아닙니다. 회사 범위 토큰으로 `/agency/*`를 부르거나, 대리인 범위 토큰으로 회사 리소스를 불렀습니다.
 *
 * 다시 로그인할 일이 아니므로 401이 아니라 403입니다(RFC 6750 `insufficient_scope`). `requiredScope`의 토큰으로 전환해서 부릅니다.
 */
export class TokenScopeMismatch extends HttpApiError.Problem<TokenScopeMismatch>()(
  'TokenScopeMismatch',
  { type: problemType('TOKEN_SCOPE_MISMATCH'), status: 403, title: 'Access token has the wrong scope' },
  { code: Schema.tag('TOKEN_SCOPE_MISMATCH'), requiredScope: Schema.Literals(['COMPANY', 'AGENCY']) },
) {}

/** 행위자에게 이 동작의 권한이 없습니다. */
export class PermissionDenied extends HttpApiError.Problem<PermissionDenied>()(
  'PermissionDenied',
  { type: problemType('PERMISSION_DENIED'), status: 403, title: 'Permission denied' },
  { code: Schema.tag('PERMISSION_DENIED'), permission: Schema.String },
) {}

/** 회사가 이 기능을 쓰는 데 필요한 플랜을 구독하지 않았습니다. */
export class EntitlementRequired extends HttpApiError.Problem<EntitlementRequired>()(
  'EntitlementRequired',
  { type: problemType('ENTITLEMENT_REQUIRED'), status: 403, title: 'Subscription plan required' },
  {
    code: Schema.tag('ENTITLEMENT_REQUIRED'),
    requiredPlans: Schema.Array(Schema.Literals(['TAXATION', 'PAYROLL'])),
  },
) {}

/** 필수 약관의 새 버전에 동의하지 않았습니다. 동의하기 전까지 해당 제품 API를 쓸 수 없습니다. */
export class TermsReagreementRequired extends HttpApiError.Problem<TermsReagreementRequired>()(
  'TermsReagreementRequired',
  { type: problemType('TERMS_REAGREEMENT_REQUIRED'), status: 403, title: 'Terms must be agreed again' },
  { code: Schema.tag('TERMS_REAGREEMENT_REQUIRED'), termCodes: Schema.Array(Schema.String) },
) {}

/** 돈이 오가거나 외부 효과가 있는 요청에 `Idempotency-Key` 헤더가 없습니다. */
export class IdempotencyKeyRequired extends HttpApiError.Problem<IdempotencyKeyRequired>()(
  'IdempotencyKeyRequired',
  { type: problemType('IDEMPOTENCY_KEY_REQUIRED'), status: 428, title: 'Idempotency-Key header required' },
  { code: Schema.tag('IDEMPOTENCY_KEY_REQUIRED') },
) {}

/** 같은 범위(회사·행위자)의 `Idempotency-Key`를 본문이 다른 요청에 다시 썼습니다. 키를 새로 만들어야 합니다. */
export class IdempotencyKeyReused extends HttpApiError.Problem<IdempotencyKeyReused>()(
  'IdempotencyKeyReused',
  { type: problemType('IDEMPOTENCY_KEY_REUSED'), status: 422, title: 'Idempotency-Key was used for another request' },
  { code: Schema.tag('IDEMPOTENCY_KEY_REUSED') },
) {}

/** 같은 `Idempotency-Key`의 앞 요청이 아직 처리 중입니다. 끝난 뒤 같은 키로 다시 보내면 처음 응답을 받습니다. */
export class IdempotencyKeyInProgress extends HttpApiError.Problem<IdempotencyKeyInProgress>()(
  'IdempotencyKeyInProgress',
  {
    type: problemType('IDEMPOTENCY_KEY_IN_PROGRESS'),
    status: 409,
    title: 'A request with this Idempotency-Key is still in progress',
  },
  { code: Schema.tag('IDEMPOTENCY_KEY_IN_PROGRESS') },
) {}

/**
 * 외부 기관(은행·금융결제원·홈택스)에 요청을 보냈지만 결과를 확인하지 못했습니다(연동 결함·시간 초과). 돈이 나갔거나 발급됐을 수
 * 있습니다. 같은 `Idempotency-Key`·같은 본문으로 다시 보내면 같은 요청으로 외부 기관에 다시 물어 결과를 받습니다. 새 키로 보내면
 * 같은 일이 두 번 일어날 수 있습니다.
 */
export class ExternalOutcomeUnknown extends HttpApiError.Problem<ExternalOutcomeUnknown>()(
  'ExternalOutcomeUnknown',
  {
    type: problemType('EXTERNAL_OUTCOME_UNKNOWN'),
    status: 503,
    title: 'The external system did not confirm the result',
  },
  { code: Schema.tag('EXTERNAL_OUTCOME_UNKNOWN') },
) {}
