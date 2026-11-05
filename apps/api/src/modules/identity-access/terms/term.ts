import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'

/** 약관 버전 ID입니다. 같은 약관의 버전마다 다릅니다. 예: `trm_01J...` */
export const TermId = IdSchema('term')

/** 약관 용도입니다. */
export const TermPurposeSchema = Schema.Literals(['SIGNUP', 'TAX', 'CONSULTING'])

/** 약관 한 버전입니다. 같은 `code`에서 `effectiveFrom`이 오늘 이전인 가장 늦은 버전이 현재 약관입니다. */
export const Term = Schema.Struct({
  id: TermId,
  /** 약관 종류입니다. 예: `SERVICE`, `PRIVACY`, `MARKETING`, `TAX_SERVICE` */
  code: Schema.String,
  purpose: TermPurposeSchema,
  title: Schema.String,
  contentUrl: Schema.String,
  version: Schema.String,
  required: Schema.Boolean,
  effectiveFrom: Schema.String,
})

export type Term = typeof Term.Type

/** 사용자 기준 약관 동의 현황입니다. */
export const TermAgreement = Schema.Struct({
  term: Term,
  status: Schema.Literals(['SETTLED', 'REQUIRED', 'REVIEW']),
  /** 마지막 응답입니다. 응답한 적이 없으면 없습니다. */
  lastDecision: Schema.optionalKey(
    Schema.Struct({ version: Schema.String, agreed: Schema.Boolean, decidedAt: Schema.String }),
  ),
})

export type TermAgreement = typeof TermAgreement.Type

/** 약관 응답 묶음입니다. 지금 버전의 약관 ID로 보냅니다. */
export const TermDecisions = Schema.Struct({
  decisions: Schema.Array(Schema.Struct({ termId: TermId, agreed: Schema.Boolean })).check(Schema.isMinLength(1)),
})

/** 저장소가 가진 동의 기록입니다. 철회도 `agreed: false`로 남기고 지우지 않습니다. */
export interface AgreementRecord {
  userId: Id<'user'>
  termId: Id<'term'>
  code: string
  version: string
  agreed: boolean
  decidedAt: string
}

/** 필수 약관을 거절했습니다. */
export class RequiredTermDeclined extends HttpApiError.Problem<RequiredTermDeclined>()(
  'RequiredTermDeclined',
  { type: problemType('REQUIRED_TERM_DECLINED'), status: 422, title: 'Required terms cannot be declined' },
  { code: Schema.tag('REQUIRED_TERM_DECLINED'), termCodes: Schema.Array(Schema.String) },
) {}

/** 지금 버전이 아니거나 없는 약관에 응답했습니다. 약관을 다시 받아 응답합니다. */
export class TermVersionOutdated extends HttpApiError.Problem<TermVersionOutdated>()(
  'TermVersionOutdated',
  { type: problemType('TERM_VERSION_OUTDATED'), status: 409, title: 'Terms have a newer version' },
  { code: Schema.tag('TERM_VERSION_OUTDATED'), termIds: Schema.Array(Schema.String) },
) {}

/** 가입·초대 수락에서 지금 필수 약관 중 동의하지 않은 것이 있습니다. */
export class RequiredTermsMissing extends HttpApiError.Problem<RequiredTermsMissing>()(
  'RequiredTermsMissing',
  { type: problemType('REQUIRED_TERMS_MISSING'), status: 422, title: 'Required terms are not agreed' },
  { code: Schema.tag('REQUIRED_TERMS_MISSING'), termCodes: Schema.Array(Schema.String) },
) {}
