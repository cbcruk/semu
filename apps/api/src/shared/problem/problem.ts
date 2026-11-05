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
