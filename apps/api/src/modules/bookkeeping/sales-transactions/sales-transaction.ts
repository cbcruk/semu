import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { PartnerId, SalesTransactionId, TaxInvoiceId } from '../common/ids.ts'
import { CalendarDate, Won } from '../common/wire.ts'

const PARTY_KEYS = [
  'businessNumber',
  'branchNumber',
  'companyName',
  'representativeName',
  'address',
  'businessType',
  'businessItem',
  'email',
  'contactName',
  'contactDepartment',
  'mobileNumber',
  'phoneNumber',
] as const

/** 공급자·공급받는 자입니다. 발급 시점 값이라 거래처를 고쳐도 바뀌지 않습니다. */
export const TransactionParty = Schema.Struct(
  Object.fromEntries(PARTY_KEYS.map((key) => [key, Schema.NullOr(Schema.String)])) as Record<
    (typeof PARTY_KEYS)[number],
    Schema.NullOr<Schema.String>
  >,
)

/** 공급자·공급받는 자 입력입니다. 없는 값은 `null`로 저장합니다. */
export const TransactionPartyInput = Schema.Struct(
  Object.fromEntries(PARTY_KEYS.map((key) => [key, Schema.optionalKey(Schema.NullOr(Schema.String))])) as Record<
    (typeof PARTY_KEYS)[number],
    Schema.optionalKey<Schema.NullOr<Schema.String>>
  >,
)

/** 품목 한 줄입니다. */
export const StatementItem = Schema.Struct({
  /** `MM-DD`입니다. */
  monthDay: Schema.String.check(
    Schema.makeFilter((value: string) => /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)),
  ),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  specification: Schema.NullOr(Schema.String),
  quantity: Schema.NullOr(Schema.String),
  unitPrice: Schema.NullOr(Won),
  supplyAmount: Won,
  vatAmount: Won,
  description: Schema.NullOr(Schema.String),
})

/** 결제 수단별 금액입니다. */
export const PaymentBreakdown = Schema.Struct({
  cashAmount: Schema.NullOr(Won),
  checkAmount: Schema.NullOr(Won),
  noteAmount: Schema.NullOr(Won),
  creditAmount: Schema.NullOr(Won),
})

/** 거래명세서 본문 필드입니다. 응답과 입력이 함께 씁니다. */
export const StatementFields = {
  partnerId: Schema.NullOr(PartnerId),
  /** `01` 세금계산서, `03` 계산서입니다. 수정 발행(`02`·`04`)은 아직 받지 않습니다. */
  invoiceClassCode: Schema.Literals(['01', '02', '03', '04']),
  /** `01` 일반, `02` 영세율입니다. 위수탁(`03`·`04`)은 아직 받지 않습니다. */
  invoiceKindCode: Schema.Literals(['01', '02', '03', '04']),
  buyerClassCode: Schema.Literals(['01', '02', '03']),
  /** `01` 영수, `02` 청구입니다. */
  purposeCode: Schema.Literals(['01', '02']),
  writeDate: CalendarDate,
  note: Schema.NullOr(Schema.String.check(Schema.isMaxLength(150))),
  payment: PaymentBreakdown,
  buyerSecondaryEmail: Schema.NullOr(Schema.String),
  items: Schema.Array(StatementItem).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  supplyAmount: Won,
  vatAmount: Won,
  totalAmount: Won,
}

/** 거래명세서입니다. 발급한 뒤에는 고치거나 지울 수 없습니다. */
export const SalesTransaction = Schema.Struct({
  id: SalesTransactionId,
  ...StatementFields,
  supplier: TransactionParty,
  buyer: TransactionParty,
  itemSummary: Schema.String,
  issueStatus: Schema.Literals(['ISSUE_REQUIRED', 'ISSUED']),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  version: Schema.Int,
})

export type SalesTransaction = typeof SalesTransaction.Type

/** 세금계산서 발급 건입니다. */
export const TaxInvoice = Schema.Struct({
  id: TaxInvoiceId,
  salesTransactionId: SalesTransactionId,
  status: Schema.Literals(['ISSUING', 'ISSUED', 'FAILED']),
  approvalNumber: Schema.NullOr(Schema.String),
  issuedAt: Schema.NullOr(Schema.String),
  detailSynced: Schema.Boolean,
  failure: Schema.NullOr(Schema.Struct({ code: Schema.String, message: Schema.String })),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export type TaxInvoice = typeof TaxInvoice.Type

/** 요청한 거래명세서가 없습니다. */
export class SalesTransactionNotFound extends HttpApiError.Problem<SalesTransactionNotFound>()(
  'SalesTransactionNotFound',
  { type: problemType('SALES_TRANSACTION_NOT_FOUND'), status: 404, title: 'Sales transaction not found' },
  { code: Schema.tag('SALES_TRANSACTION_NOT_FOUND') },
) {}

/** 거래명세서가 발급 규칙에 맞지 않습니다. 문제를 모두 줍니다. */
export class SalesStatementInvalid extends HttpApiError.Problem<SalesStatementInvalid>()(
  'SalesStatementInvalid',
  { type: problemType('SALES_STATEMENT_INVALID'), status: 422, title: 'Sales statement is invalid' },
  {
    code: Schema.tag('SALES_STATEMENT_INVALID'),
    problems: Schema.Array(
      Schema.Struct({
        code: Schema.Literals(['UNSUPPORTED', 'AMOUNT_MISMATCH']),
        field: Schema.Literals(['invoiceKindCode', 'invoiceClassCode', 'supplyAmount', 'vatAmount', 'totalAmount']),
      }),
    ),
  },
) {}

/** 세금계산서를 발급했거나 발급 중이라 거래명세서를 바꿀 수 없습니다. */
export class SalesTransactionLocked extends HttpApiError.Problem<SalesTransactionLocked>()(
  'SalesTransactionLocked',
  { type: problemType('SALES_TRANSACTION_LOCKED'), status: 409, title: 'Tax invoice already issued' },
  { code: Schema.tag('SALES_TRANSACTION_LOCKED'), lock: Schema.Literals(['ISSUED', 'ISSUING']) },
) {}

/** 요청한 세금계산서 발급 건이 없습니다. */
export class TaxInvoiceNotFound extends HttpApiError.Problem<TaxInvoiceNotFound>()(
  'TaxInvoiceNotFound',
  { type: problemType('TAX_INVOICE_NOT_FOUND'), status: 404, title: 'Tax invoice not found' },
  { code: Schema.tag('TAX_INVOICE_NOT_FOUND') },
) {}

/** 홈택스가 발급을 거절했습니다. 실패한 발급 건은 남고, 고친 뒤 새 키로 다시 발급합니다. */
export class TaxInvoiceRejected extends HttpApiError.Problem<TaxInvoiceRejected>()(
  'TaxInvoiceRejected',
  { type: problemType('TAX_INVOICE_REJECTED'), status: 422, title: 'Hometax rejected the tax invoice' },
  {
    code: Schema.tag('TAX_INVOICE_REJECTED'),
    taxInvoiceId: TaxInvoiceId,
    errorCode: Schema.String,
    errorMessage: Schema.String,
  },
) {}

/** 같은 `Idempotency-Key`를 다른 거래명세서에 썼습니다. 공통 문제 유형이라 `shared/problem`에 있습니다. */
export { IdempotencyKeyReused } from '../../../shared/problem/problem.ts'
