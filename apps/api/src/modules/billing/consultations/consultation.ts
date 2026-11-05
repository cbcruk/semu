import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import type { Plan } from '../../identity-access/actor.types.ts'
import { PlanSchema } from '../subscriptions/subscription.ts'

/** 상담 신청 ID입니다. 상담 신청은 영업 리드(`led_`)입니다. */
export type ConsultationId = Id<'lead'>

/** 상담 진행 상태입니다. 담당자가 연락하면 `CONTACTED`, 계약하거나 접으면 `CLOSED`입니다. */
export const ConsultationStatus = Schema.Literals(['NEW', 'CONTACTED', 'CLOSED'])
export type ConsultationStatus = typeof ConsultationStatus.Type

/** 상담 신청입니다. 회사 이름·사업자번호·형태는 토큰의 회사에서 가져오므로 받지 않습니다. */
export const Consultation = Schema.Struct({
  id: IdSchema('lead'),
  products: Schema.Array(PlanSchema),
  status: ConsultationStatus,
  name: Schema.String,
  phone: Schema.String,
  email: Schema.String,
  memo: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
})
export type Consultation = typeof Consultation.Type

/** 저장하는 상담 신청입니다. 동의 일자는 서버가 접수한 날로 찍습니다. */
export interface ConsultationRecord {
  id: ConsultationId
  companyId: Id<'company'>
  requestedBy: Id<'user'>
  products: Plan[]
  status: ConsultationStatus
  name: string
  phone: string
  email: string
  memo?: string | undefined
  privacyAgreedOn: string
  thirdPartyAgreedOn: string
  createdAt: string
}

/**
 * 도입 문의 요청입니다. 현행 `labelIds:[38=TAX|27=PAYROLL]`은 `products`, 동의 날짜 두 개는 `true` 동의 필드가 됩니다.
 * 동의하지 않으면 접수할 수 없으므로 `true`만 받습니다.
 */
export const ConsultationRequest = Schema.Struct({
  products: Schema.Array(PlanSchema).pipe(Schema.check(Schema.isMinLength(1))),
  name: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(50))),
  /** 숫자만, 휴대전화·지역번호 포함 9–11자리입니다. */
  phone: Schema.String.pipe(Schema.check(Schema.isPattern(/^0\d{8,10}$/))),
  email: Schema.String.pipe(Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))),
  memo: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isMaxLength(1000)))),
  privacyConsent: Schema.Literal(true),
  thirdPartyConsent: Schema.Literal(true),
})
export type ConsultationRequest = typeof ConsultationRequest.Type

/** 같은 상품의 상담이 아직 진행 중입니다. 중복 접수로 담당자 연락이 겹치지 않게 막습니다. */
export class ConsultationAlreadyOpen extends HttpApiError.Problem<ConsultationAlreadyOpen>()(
  'ConsultationAlreadyOpen',
  { type: problemType('CONSULTATION_ALREADY_OPEN'), status: 409, title: 'Consultation already open' },
  { code: Schema.tag('CONSULTATION_ALREADY_OPEN'), consultationId: Schema.String },
) {}

/** 이미 구독 중인 상품의 도입 문의입니다. */
export class ProductAlreadySubscribed extends HttpApiError.Problem<ProductAlreadySubscribed>()(
  'ProductAlreadySubscribed',
  { type: problemType('PRODUCT_ALREADY_SUBSCRIBED'), status: 409, title: 'Product already subscribed' },
  { code: Schema.tag('PRODUCT_ALREADY_SUBSCRIBED'), products: Schema.Array(PlanSchema) },
) {}
