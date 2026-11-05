import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Classification } from '../evidence/evidence.types.ts'

/** 은행 연동의 `AccountType` 코드입니다. `01` 입출금, `02` 예적금, `11` 신탁, `21` 펀드, `31` 외화·골드, `41` 대출, `51` 보험, `61` 연금. */
export type BankAccountTypeCode = '01' | '02' | '11' | '21' | '31' | '41' | '51' | '61'

/** 입금·출금입니다. */
export type Direction = 'DEPOSIT' | 'WITHDRAWAL'

/** 저장한 은행 계좌입니다. 계좌번호 원문은 암호문으로만 둡니다. */
export interface BankAccountRecord {
  id: Id<'bankAccount'>
  companyId: Id<'company'>
  bankCode: string
  accountNumberEncrypted: string
  /** 숫자만 남긴 계좌번호의 SHA-256입니다. 수집 레코드를 기존 계좌에 맞추는 키입니다. */
  accountNumberDigest: string
  accountNumberLast4: string
  alias: string | null
  accountTypeCode: BankAccountTypeCode
  isCorporate: boolean
  currencyCode: string
  holder: string | null
  openedOn: string | null
  maturesOn: string | null
  /** 원화 잔액입니다. 외화 계좌는 환산한 값입니다. */
  balance: number | null
  status: 'ACTIVE' | 'INACTIVE' | 'DORMANT'
  /** 자금 현황에 넣을지입니다(계좌 표시 설정). */
  cashReport: 'INCLUDED' | 'EXCLUDED'
  lastTransactionOn: string | null
  version: number
}

/** 하루 마감 잔액입니다. 은행이 준 값(`SCRAPED`)이 거래 잔액으로 만든 값(`DERIVED`)보다 우선합니다. */
export interface BalanceSnapshotRecord {
  /** `<계좌 ID>:<날짜>`입니다. */
  id: string
  companyId: Id<'company'>
  bankAccountId: Id<'bankAccount'>
  date: string
  closingBalance: number
  source: 'SCRAPED' | 'DERIVED'
}

/** 저장한 입출금 거래입니다. `amount`는 부호가 있고 출금은 음수입니다. */
export interface BankTransactionRecord {
  id: Id<'bankTransaction'>
  companyId: Id<'company'>
  bankAccountId: Id<'bankAccount'>
  externalKey: string
  /** 분 단위 시각입니다. 예: `2026-10-06T10:00:00+09:00` */
  transactedAt: string
  direction: Direction
  amount: number
  balanceAfter: number | null
  summary: string | null
  currencyCode: string
  partnerId: Id<'partner'> | null
  classification: Classification
  memo: string | null
  syncedAt: string
  version: number
}

/** 입출금 거래와 그 거래가 정산한 증빙의 연결입니다. 부분 입금·묶음 입금 때문에 N:M입니다. */
export interface SettlementLinkRecord {
  id: Id<'settlementLink'>
  companyId: Id<'company'>
  bankTransactionId: Id<'bankTransaction'>
  evidenceId: Id<'evidence'>
  amount: number
  createdAt: string
}

/** 증빙 연결 상태입니다. 저장하지 않고 분류·거래처·연결 금액에서 계산합니다. */
export type SettlementMatchStatus = 'PARTNER_REQUIRED' | 'UNMATCHED' | 'MATCHED' | 'NOT_APPLICABLE'
