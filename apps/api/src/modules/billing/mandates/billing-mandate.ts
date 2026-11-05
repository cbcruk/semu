import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'

/** CMS 출금 동의 ID입니다. */
export type BillingMandateId = Id<'billingMandate'>

/** 출금 동의를 받은 경로입니다. `ONLINE`은 화면에서 계좌를 입력, `UPLOAD`는 서면 동의서 파일입니다. */
export const MandateSource = Schema.Literals(['ONLINE', 'UPLOAD'])

/**
 * 출금 동의 상태입니다.
 *
 * - `PENDING`: 은행 등록 결과를 기다림(서면 동의서)
 * - `REGISTERED`: 출금에 쓰는 계좌. 회사마다 하나뿐입니다
 * - `REJECTED`: 은행이 계좌를 거절함
 * - `REVOKED`: 새 계좌로 바뀌었거나 해지됨
 */
export const MandateStatus = Schema.Literals(['PENDING', 'REGISTERED', 'REJECTED', 'REVOKED'])
export type MandateStatus = typeof MandateStatus.Type

/** 은행이 계좌를 거절한 사유입니다. */
export const MandateRejectionReason = Schema.Literals(['ACCOUNT_NOT_FOUND', 'HOLDER_MISMATCH', 'OTHER'])
export type MandateRejectionReason = typeof MandateRejectionReason.Type

/** CMS 자동출금 동의(결제 수단)입니다. 계좌번호 원문은 응답에 넣지 않습니다. */
export const BillingMandate = Schema.Struct({
  id: IdSchema('billingMandate'),
  bankCode: Schema.String,
  accountNumberMasked: Schema.String,
  accountHolder: Schema.String,
  source: MandateSource,
  status: MandateStatus,
  rejectionReason: Schema.optionalKey(MandateRejectionReason),
  createdAt: Schema.String,
  registeredAt: Schema.optionalKey(Schema.String),
})
export type BillingMandate = typeof BillingMandate.Type

/**
 * 저장하는 출금 동의입니다. 계좌번호와 납부자 번호 원문은 CMS 게이트웨이에만 넘기고 여기에는 두지 않습니다.
 * 출금은 게이트웨이 참조(`gatewayReference`)로 요청합니다.
 */
export interface BillingMandateRecord {
  id: BillingMandateId
  companyId: Id<'company'>
  bankCode: string
  accountNumberMasked: string
  accountHolder: string
  source: typeof MandateSource.Type
  status: MandateStatus
  rejectionReason?: MandateRejectionReason | undefined
  gatewayReference?: string | undefined
  createdAt: string
  registeredAt?: string | undefined
}

/** 온라인 출금 동의 요청입니다. */
export const MandateRegistration = Schema.Struct({
  /** 금융결제원 은행 코드 3자리입니다. */
  bankCode: Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{3}$/))),
  /** 숫자와 `-`만 받습니다. 저장하지 않습니다. */
  accountNumber: Schema.String.pipe(Schema.check(Schema.isPattern(/^[\d-]{6,20}$/))),
  accountHolder: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(50))),
  /** 예금주 생년월일 6자리(개인) 또는 사업자번호 10자리(법인)입니다. 저장하지 않습니다. */
  payerNumber: Schema.String.pipe(Schema.check(Schema.isPattern(/^(\d{6}|\d{10})$/))),
})
export type MandateRegistration = typeof MandateRegistration.Type

/** 은행이 출금 계좌를 거절했습니다. 거절한 시도도 기록에 남습니다. */
export class MandateRejected extends HttpApiError.Problem<MandateRejected>()(
  'MandateRejected',
  { type: problemType('MANDATE_REJECTED'), status: 422, title: 'Bank rejected the withdrawal account' },
  { code: Schema.tag('MANDATE_REJECTED'), mandateId: Schema.String, reason: MandateRejectionReason },
) {}

/** 계좌번호를 끝 4자리만 남기고 가립니다. 예: `*********4321` */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replaceAll('-', '')
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}
