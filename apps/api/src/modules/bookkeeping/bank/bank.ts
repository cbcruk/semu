import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { BankAccountId, BankTransactionId, EvidenceId, PartnerId, SettlementLinkId } from '../common/ids.ts'
import { CalendarDate, Won } from '../common/wire.ts'
import { ClassificationView } from '../evidence/evidence.ts'

/** 입금·출금입니다. */
export const Direction = Schema.Literals(['DEPOSIT', 'WITHDRAWAL'])

/** 은행 계좌입니다. 계좌번호는 끝 4자리만 보입니다. */
export const BankAccount = Schema.Struct({
  id: BankAccountId,
  bankCode: Schema.String,
  accountNumberMasked: Schema.String,
  alias: Schema.NullOr(Schema.String),
  /** `01` 입출금, `02` 예적금, `11` 신탁, `21` 펀드, `31` 외화·골드, `41` 대출, `51` 보험, `61` 연금입니다. */
  accountTypeCode: Schema.Literals(['01', '02', '11', '21', '31', '41', '51', '61']),
  isCorporate: Schema.Boolean,
  currencyCode: Schema.String,
  holder: Schema.NullOr(Schema.String),
  openedOn: Schema.NullOr(CalendarDate),
  maturesOn: Schema.NullOr(CalendarDate),
  balance: Schema.NullOr(Won),
  status: Schema.Literals(['ACTIVE', 'INACTIVE', 'DORMANT']),
  /** 자금 현황에 넣을지입니다. */
  cashReport: Schema.Literals(['INCLUDED', 'EXCLUDED']),
  lastTransactionOn: Schema.NullOr(CalendarDate),
  version: Schema.Int,
})

export type BankAccount = typeof BankAccount.Type

const Bucket = Schema.Literals(['DEMAND', 'FOREIGN_CURRENCY', 'SAVINGS', 'FUND', 'TRUST', 'INSURANCE', 'PENSION'])

/** 계좌 목록 요약입니다. 대출은 부채, 나머지는 자산입니다. */
export const BankAccountSummary = Schema.Struct({
  activeAccountCount: Schema.Int,
  totalAssetAmount: Won,
  assetAmountByBucket: Schema.Record(Bucket, Won),
  totalLiabilityAmount: Won,
})

/** 하루 마감 잔액입니다. */
export const BalanceSnapshot = Schema.Struct({
  date: CalendarDate,
  closingBalance: Won,
  source: Schema.Literals(['SCRAPED', 'DERIVED']),
})

/** 입출금 거래가 정산한 증빙 하나입니다. */
export const SettlementLink = Schema.Struct({ id: SettlementLinkId, evidenceId: EvidenceId, amount: Won })

/** 입출금 거래입니다. `amount`는 부호가 있고 출금은 음수입니다. */
export const BankTransaction = Schema.Struct({
  id: BankTransactionId,
  bankAccountId: BankAccountId,
  transactedAt: Schema.String,
  direction: Direction,
  amount: Won,
  balanceAfter: Schema.NullOr(Won),
  summary: Schema.NullOr(Schema.String),
  currencyCode: Schema.String,
  partnerId: Schema.NullOr(PartnerId),
  classification: ClassificationView,
  memo: Schema.NullOr(Schema.String),
  /** 증빙 연결입니다. `status`는 저장하지 않고 분류·거래처·연결 금액으로 계산합니다. */
  settlement: Schema.Struct({
    status: Schema.Literals(['PARTNER_REQUIRED', 'UNMATCHED', 'MATCHED', 'NOT_APPLICABLE']),
    linkedAmount: Won,
    links: Schema.Array(SettlementLink),
  }),
  syncedAt: Schema.String,
  version: Schema.Int,
})

export type BankTransaction = typeof BankTransaction.Type

/** 요청한 계좌가 없습니다. */
export class BankAccountNotFound extends HttpApiError.Problem<BankAccountNotFound>()(
  'BankAccountNotFound',
  { type: problemType('BANK_ACCOUNT_NOT_FOUND'), status: 404, title: 'Bank account not found' },
  { code: Schema.tag('BANK_ACCOUNT_NOT_FOUND') },
) {}

/** 요청한 입출금 거래가 없습니다. */
export class BankTransactionNotFound extends HttpApiError.Problem<BankTransactionNotFound>()(
  'BankTransactionNotFound',
  { type: problemType('BANK_TRANSACTION_NOT_FOUND'), status: 404, title: 'Bank transaction not found' },
  { code: Schema.tag('BANK_TRANSACTION_NOT_FOUND') },
) {}

/** 증빙 연결이 규칙에 맞지 않습니다. 아무것도 바꾸지 않았습니다. */
export class SettlementLinkInvalid extends HttpApiError.Problem<SettlementLinkInvalid>()(
  'SettlementLinkInvalid',
  { type: problemType('SETTLEMENT_LINK_INVALID'), status: 422, title: 'Settlement link is not allowed' },
  {
    code: Schema.tag('SETTLEMENT_LINK_INVALID'),
    reason: Schema.Literals([
      'SIDE_MISMATCH',
      'PARTNER_MISMATCH',
      'EXCEEDS_EVIDENCE',
      'EXCEEDS_TRANSACTION',
      'AMOUNT_NOT_POSITIVE',
      'EVIDENCE_NOT_FOUND',
    ]),
  },
) {}
