import type { BankAccountTypeCode } from '../bank/bank.types.ts'
import type { EvidenceDocType, EvidenceKind, EvidenceSource, VatDeduction } from '../evidence/evidence.types.ts'
import type { ScrapedGiroBill } from '../giros/giro.types.ts'

/** 수집한 매출·매입 증빙 한 건입니다. 금액은 원천이 준 값 그대로이고 없으면 비웁니다. */
export interface ScrapedEvidence {
  type: 'SALES_EVIDENCE' | 'PURCHASE_EVIDENCE'
  source: EvidenceSource
  /** 원천 안에서 유일한 키입니다. 같은 키가 다시 오면 덮어씁니다. */
  externalKey: string
  writtenOn: string
  issuedOn?: string
  docType?: EvidenceDocType
  kind?: EvidenceKind
  counterpartyName?: string
  counterpartyBusinessNumber?: string
  itemSummary?: string
  totalAmount?: number
  supplyAmount?: number
  vatAmount?: number
  card?: { numberMasked: string; companyCode?: string; approvalNo?: string }
  channel?: string
  isCanceled?: boolean
  dedupeGroup?: string
  /** 매입만 씁니다. 홈택스 카드 공제 여부입니다. */
  vatDeduction?: VatDeduction
}

/** 카드사에서 수집한 승인 한 건입니다. 매입 카드 증빙이 됩니다. */
export interface ScrapedCardApproval {
  type: 'CARD_APPROVAL'
  cardNumberMasked: string
  cardCompanyCode?: string
  approvalNo: string
  /** RFC 3339 승인 시각입니다. */
  approvedAt: string
  merchantName?: string
  merchantBusinessNumber?: string
  /** 부가세 포함 승인 금액입니다. 취소는 음수입니다. */
  amount: number
  vatAmount?: number
  isCanceled?: boolean
}

/** 수집한 은행 계좌입니다. 계좌번호 원문은 이 기록으로만 들어오고 바로 암호화합니다. */
export interface ScrapedBankAccount {
  type: 'BANK_ACCOUNT'
  bankCode: string
  accountNumber: string
  accountTypeCode: BankAccountTypeCode
  alias?: string
  holder?: string
  isCorporate?: boolean
  currencyCode?: string
  balance?: number
  openedOn?: string
  maturesOn?: string
  status?: 'ACTIVE' | 'INACTIVE' | 'DORMANT'
}

/** 수집한 입출금 거래입니다. `amount`는 부호가 있고 출금은 음수입니다. */
export interface ScrapedBankTransaction {
  type: 'BANK_TRANSACTION'
  bankCode: string
  accountNumber: string
  externalKey: string
  /** 분 단위 RFC 3339 시각입니다. */
  transactedAt: string
  amount: number
  balanceAfter?: number
  summary?: string
  currencyCode?: string
}

/** 은행이 준 하루 마감 잔액입니다. 거래 잔액으로 만든 값보다 우선합니다. */
export interface ScrapedBankBalance {
  type: 'BANK_BALANCE'
  bankCode: string
  accountNumber: string
  date: string
  closingBalance: number
}

/** 인터넷지로 전체 목록입니다. 목록에 없는 납부 필요 고지서는 확인 필요가 됩니다. */
export interface ScrapedGiroBills {
  type: 'GIRO_BILLS'
  bills: ReadonlyArray<ScrapedGiroBill>
}

/** Integrations가 Bookkeeping에 넘기는 수집 레코드입니다. */
export type ScrapedRecord =
  | ScrapedEvidence
  | ScrapedCardApproval
  | ScrapedBankAccount
  | ScrapedBankTransaction
  | ScrapedBankBalance
  | ScrapedGiroBills

/** 받지 않은 레코드의 이유입니다. */
export type IngestionRejection =
  'DATE_INVALID' | 'AMOUNTS_MISSING' | 'SOURCE_SIDE_MISMATCH' | 'BANK_ACCOUNT_UNKNOWN' | 'EXTERNAL_KEY_MISSING'

/** 한 번 받은 결과입니다. `rejected[].index`는 보낸 배열의 위치입니다. */
export interface IngestionResult {
  insertedCount: number
  updatedCount: number
  rejected: Array<{ index: number; reason: IngestionRejection }>
  /** 새로 들어온 행 가운데 규칙으로 분류한 수입니다. */
  classifiedCount: number
}
