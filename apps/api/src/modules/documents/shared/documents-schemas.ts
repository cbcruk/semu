import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../../shared/problem/problem.ts'
import type { Permission, Plan } from '../../identity-access/actor.types.ts'
import type { AccessRequirement } from '../../identity-access/authorization.ts'

/** 전자서명 요청 ID입니다. 예: `esr_01J...` */
export const EsignRequestId = IdSchema('esignRequest')

/** 전자서명 템플릿 ID입니다. */
export const EsignTemplateId = IdSchema('esignTemplate')

/** 제증명 발급 ID입니다. */
export const CertificateIssuanceId = IdSchema('certificateIssuance')

/** 직원 ID입니다. 인사 컨텍스트의 ID를 그대로 씁니다. */
export const EmployeeId = IdSchema('employee')

/** 파일 ID입니다. */
export const FileId = IdSchema('file')

/** 회사 직인 ID입니다. 예: `sel_01J...` */
export const CompanySealId = IdSchema('companySeal')

/** 다른 사람의 변경을 덮어쓰지 않도록 보내는 버전입니다. 예: `"7"` */
export const IfMatchHeaders = { 'if-match': Schema.optionalKey(Schema.String) }

/** 422로 돌려주는 위반 목록입니다. */
export const Violations = Schema.Array(Schema.Struct({ field: Schema.String, code: Schema.String }))

/** 문서 기능을 쓰는 플랜입니다. 전자서명·제증명은 급여 플랜에 들어 있습니다. */
export const DOCUMENTS_PLANS: ReadonlyArray<Plan> = ['PAYROLL']

/** 인증이 필요한 모든 문서 엔드포인트가 선언하는 접근 오류입니다. */
export const ACCESS_ERRORS = [PermissionDenied, EntitlementRequired, TermsReagreementRequired] as const

/** 문서 엔드포인트의 접근 요건입니다. */
export function documentsAccess(permission: Permission): AccessRequirement {
  return { permission, plans: DOCUMENTS_PLANS, requiresTerms: true }
}
