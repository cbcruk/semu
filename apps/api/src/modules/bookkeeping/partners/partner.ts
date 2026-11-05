import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { PartnerId } from '../common/ids.ts'
import { CalendarDate, Won } from '../common/wire.ts'

/** 국세청 사업자 상태입니다. */
export const BusinessStatus = Schema.Literals(['REGISTERED', 'SUSPENDED', 'CLOSED', 'UNKNOWN'])

/** 거래처 유형입니다. */
export const PartnerType = Schema.Literals(['CORPORATE_BUSINESS', 'INDIVIDUAL_BUSINESS', 'NON_BUSINESS'])

/** 거래처 구분입니다. */
export const PartnerRole = Schema.Literals(['SALES', 'PURCHASE'])

/** 사업자번호입니다. `-`는 있어도 되고 저장할 때 뺍니다. */
export const BusinessNumber = Schema.String.check(
  Schema.makeFilter((value: string) => /^\d{10}$/.test(value.replace(/-/g, ''))),
)

/** 거래처 담당자입니다. */
export const PartnerContact = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  department: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  phoneNumber: Schema.NullOr(Schema.String),
  mobileNumber: Schema.NullOr(Schema.String),
  faxNumber: Schema.NullOr(Schema.String),
})

/** 거래처입니다. `outstanding`은 분류된 증빙 합계에서 연결된 입출금을 뺀 실시간 미정산 금액입니다. */
export const Partner = Schema.Struct({
  id: PartnerId,
  type: PartnerType,
  roles: Schema.Array(PartnerRole),
  name: Schema.String,
  representativeName: Schema.String,
  businessNumber: Schema.NullOr(Schema.String),
  businessStatus: Schema.NullOr(BusinessStatus),
  businessType: Schema.NullOr(Schema.String),
  businessItem: Schema.NullOr(Schema.String),
  address: Schema.NullOr(Schema.String),
  phoneNumber: Schema.NullOr(Schema.String),
  memo: Schema.NullOr(Schema.String),
  bankAccounts: Schema.Array(
    Schema.Struct({
      bankCode: Schema.String,
      accountNumberMasked: Schema.String,
      alias: Schema.NullOr(Schema.String),
      isPrimary: Schema.Boolean,
    }),
  ),
  contacts: Schema.Array(PartnerContact),
  outstanding: Schema.Struct({ salesAmount: Won, purchaseAmount: Won }),
  createdAt: Schema.String,
  version: Schema.Int,
})

export type Partner = typeof Partner.Type

/** 사업자 상태조회 결과입니다. 같은 날 조회한 결과는 다시 씁니다. */
export const BusinessStatusResult = Schema.Struct({
  businessNumber: Schema.String,
  status: BusinessStatus,
  taxationType: Schema.NullOr(Schema.String),
  closedOn: Schema.NullOr(CalendarDate),
  checkedAt: Schema.String,
})

/** 같은 사업자번호의 거래처가 이미 있습니다. */
export class PartnerBusinessNumberDuplicate extends HttpApiError.Problem<PartnerBusinessNumberDuplicate>()(
  'PartnerBusinessNumberDuplicate',
  { type: problemType('PARTNER_BUSINESS_NUMBER_DUPLICATE'), status: 409, title: 'Partner already exists' },
  { code: Schema.tag('PARTNER_BUSINESS_NUMBER_DUPLICATE'), partnerId: PartnerId },
) {}

/** 사업자 거래처에는 사업자번호가 있어야 합니다. */
export class PartnerBusinessNumberRequired extends HttpApiError.Problem<PartnerBusinessNumberRequired>()(
  'PartnerBusinessNumberRequired',
  { type: problemType('PARTNER_BUSINESS_NUMBER_REQUIRED'), status: 422, title: 'Business partners need a number' },
  { code: Schema.tag('PARTNER_BUSINESS_NUMBER_REQUIRED') },
) {}
