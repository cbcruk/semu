import type { Id } from '../../../shared/ids/ids.types.ts'

/** 담당자가 올리는 손익 섹션입니다. 매출총이익·영업이익·당기순이익은 이 값으로 서버가 계산합니다. */
export type ProfitLossInputSection =
  | 'REVENUE'
  | 'COST_OF_SALES'
  | 'SELLING_AND_ADMINISTRATIVE_EXPENSES'
  | 'NON_OPERATING_INCOME'
  | 'NON_OPERATING_EXPENSES'
  | 'INCOME_TAXES'

/** 서버가 계산하는 손익 섹션입니다. */
export type ProfitLossDerivedSection = 'GROSS_PROFIT' | 'OPERATING_INCOME' | 'NET_INCOME'

export type ProfitLossSection = ProfitLossInputSection | ProfitLossDerivedSection

/** 계정 하나의 금액(원)입니다. 섹션 합계에 더하는 부호로 적습니다(예: 매출원가의 기말재고액은 음수). */
export interface SettlementAccountAmount {
  name: string
  amount: number
}

/** 섹션 하나의 합계와 계정별 금액입니다. 계산 섹션은 계정이 없습니다. */
export interface ProfitLossSectionAmount {
  amount: number
  accounts: ReadonlyArray<SettlementAccountAmount>
}

/** 담당자가 올린 한 달 손익입니다. */
export interface ProfitLossInputMonth {
  /** `YYYY-MM` */
  month: string
  sections: Readonly<Record<ProfitLossInputSection, ProfitLossSectionAmount>>
}

/** 계산 섹션까지 채운 한 달 손익입니다. */
export interface ProfitLossMonth {
  month: string
  sections: Readonly<Record<ProfitLossSection, ProfitLossSectionAmount>>
}

/** 사업연도 기간입니다. */
export interface FiscalPeriod {
  /** `YYYY-MM-DD` */
  start: string
  /** `YYYY-MM-DD` */
  end: string
}

/** 손익 스냅샷 업로드 본문입니다. */
export interface ProfitLossUpload {
  /** 결산 기준일(`YYYY-MM-DD`)입니다. 이날이 속한 달까지 월별 손익이 있어야 합니다. */
  closedThrough: string
  months: ReadonlyArray<ProfitLossInputMonth>
}

/** 저장하는 손익 스냅샷입니다. 회사·사업연도마다 한 건이고, 업로드할 때마다 통째로 바뀝니다. */
export interface ProfitLossSnapshotRecord {
  companyId: Id<'company'>
  /** 사업연도가 끝나는 해입니다. 법인세 확정 신고 건의 기간 이름과 같습니다. */
  fiscalYear: number
  period: FiscalPeriod
  closedThrough: string
  months: ReadonlyArray<ProfitLossInputMonth>
  version: number
  updatedAt: string
  updatedBy: Id<'user'>
}

export type SettlementSnapshotInvalidReason =
  | 'CLOSED_THROUGH_OUT_OF_PERIOD'
  | 'CLOSED_THROUGH_IN_FUTURE'
  | 'CLOSED_THROUGH_NOT_MONTH_END'
  | 'MONTH_OUT_OF_RANGE'
  | 'MONTH_DUPLICATED'
  | 'MONTH_MISSING'
  | 'ACCOUNT_NAME_BLANK'
  | 'ACCOUNT_DUPLICATED'
  | 'SECTION_TOTAL_MISMATCH'
  | 'CASH_AMOUNT_NEGATIVE'
  | 'CASH_BALANCE_MISMATCH'

/** 결산 스냅샷 업로드 검증 위반입니다. `field`는 본문 안의 위치(`months[2].sections.REVENUE`)입니다. */
export interface SettlementSnapshotViolation {
  reason: SettlementSnapshotInvalidReason
  field: string
}

/** 자금 흐름을 보는 현금성 계정입니다. 현금, 당좌예금, 보통예금, 제예금(그 밖의 예금)입니다. */
export type CashAccount = 'CASH' | 'CHECKING_DEPOSIT' | 'ORDINARY_DEPOSIT' | 'OTHER_DEPOSITS'

/** 현금성 계정 하나의 한 달 입출금과 월말 잔액(원)입니다. */
export interface CashAccountMonth {
  inflow: number
  outflow: number
  closingBalance: number
}

/** 담당자가 올린 한 달 자금 흐름입니다. */
export interface CashFlowInputMonth {
  /** `YYYY-MM` */
  month: string
  accounts: Readonly<Record<CashAccount, CashAccountMonth>>
}

/** 자금 흐름 스냅샷 업로드 본문입니다. */
export interface CashFlowUpload {
  closedThrough: string
  /** 사업연도 시작일의 계정별 잔액(기초 잔액)입니다. 첫 달 잔액을 맞추는 데 씁니다. */
  openingBalances: Readonly<Record<CashAccount, number>>
  months: ReadonlyArray<CashFlowInputMonth>
}

/** 저장하는 자금 흐름 스냅샷입니다. 회사·사업연도마다 한 건이고, 업로드할 때마다 통째로 바뀝니다. */
export interface CashFlowSnapshotRecord {
  companyId: Id<'company'>
  fiscalYear: number
  period: FiscalPeriod
  closedThrough: string
  openingBalances: Readonly<Record<CashAccount, number>>
  months: ReadonlyArray<CashFlowInputMonth>
  version: number
  updatedAt: string
  updatedBy: Id<'user'>
}

/** 계정을 합친 한 달 자금 흐름입니다. */
export interface CashFlowMonth {
  month: string
  accounts: Readonly<Record<CashAccount, CashAccountMonth>>
  inflow: number
  outflow: number
  /** 순유입 = 유입 − 유출. 음수면 순유출입니다. */
  netInflow: number
  /** 보유자금 = 네 계정의 월말 잔액 합입니다. */
  fundsHeld: number
}
