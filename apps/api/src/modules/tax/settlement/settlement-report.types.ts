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

/** 모든 결산 스냅샷이 갖는 메타데이터입니다. 회사·사업연도마다 한 건이고, 업로드할 때마다 통째로 바뀝니다. */
export interface SettlementSnapshotMeta {
  companyId: Id<'company'>
  /** 사업연도가 끝나는 해입니다. 법인세 확정 신고 건의 기간 이름과 같습니다. */
  fiscalYear: number
  period: FiscalPeriod
  /** 결산 기준일(월말)입니다. */
  closedThrough: string
  version: number
  updatedAt: string
  updatedBy: Id<'user'>
}

/** 저장하는 손익 스냅샷입니다. */
export interface ProfitLossSnapshotRecord extends SettlementSnapshotMeta {
  months: ReadonlyArray<ProfitLossInputMonth>
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
  | 'BALANCE_SHEET_UNBALANCED'
  | 'CURRENT_ASSET_COMPONENT_INVALID'
  | 'PARTNER_BLANK'
  | 'PARTNER_DUPLICATED'
  | 'ENTRY_DATE_OUT_OF_RANGE'
  | 'ENTRY_AMOUNT_NEGATIVE'

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

/** 저장하는 자금 흐름 스냅샷입니다. */
export interface CashFlowSnapshotRecord extends SettlementSnapshotMeta {
  openingBalances: Readonly<Record<CashAccount, number>>
  months: ReadonlyArray<CashFlowInputMonth>
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

/** 재무상태표의 구분입니다. 자산 둘, 부채 둘, 자본 다섯입니다. */
export type BalanceSheetGroup =
  | 'CURRENT_ASSETS'
  | 'NON_CURRENT_ASSETS'
  | 'CURRENT_LIABILITIES'
  | 'NON_CURRENT_LIABILITIES'
  | 'CAPITAL_STOCK'
  | 'CAPITAL_SURPLUS'
  | 'CAPITAL_ADJUSTMENTS'
  | 'ACCUMULATED_OTHER_COMPREHENSIVE_INCOME'
  | 'RETAINED_EARNINGS'

/** 담당자가 올린 한 달 말의 재무상태입니다. */
export interface BalanceSheetInputMonth {
  /** `YYYY-MM`. 그 달 말일의 잔액입니다. */
  month: string
  groups: Readonly<Record<BalanceSheetGroup, ProfitLossSectionAmount>>
  /** 유동자산 중 재고자산(원)입니다. 재고자산회전율에 씁니다. */
  inventories: number
  /** 유동자산 중 매출채권(원)입니다. 매출채권회전율에 씁니다. */
  tradeReceivables: number
}

/** 재무상태표 스냅샷 업로드 본문입니다. */
export interface BalanceSheetUpload {
  closedThrough: string
  months: ReadonlyArray<BalanceSheetInputMonth>
}

/** 저장하는 재무상태표 스냅샷입니다. */
export interface BalanceSheetSnapshotRecord extends SettlementSnapshotMeta {
  months: ReadonlyArray<BalanceSheetInputMonth>
}

/** 재무 비율입니다. ppm(1 = 1,000,000)이고, 분모가 0이거나 손익 자료가 없으면 `null`입니다. */
export interface BalanceSheetRatios {
  equityRatioPpm: number | null
  debtRatioPpm: number | null
  currentRatioPpm: number | null
  returnOnAssetsPpm: number | null
  returnOnEquityPpm: number | null
  totalAssetTurnoverPpm: number | null
  inventoryTurnoverPpm: number | null
  receivablesTurnoverPpm: number | null
}

/** 사업연도 첫 달부터 그 달까지의 손익 누계입니다. 비율 계산에 씁니다. */
export interface CumulativeProfitLoss {
  revenue: number
  netIncome: number
}

/** 합계와 비율을 채운 한 달 재무상태표입니다. */
export interface BalanceSheetMonth extends BalanceSheetInputMonth {
  totals: { assets: number; liabilities: number; equity: number; liabilitiesAndEquity: number }
  ratios: BalanceSheetRatios
}

/** 미수(받을 돈)와 미지급(줄 돈)입니다. */
export type ReceivablePayableKind = 'RECEIVABLE' | 'PAYABLE'

/** 거래처 원장의 거래 한 건입니다. 증가는 채권·채무가 늘어난 금액, 감소는 회수·지급한 금액(원, 0 이상)입니다. */
export interface PartnerLedgerEntry {
  /** `YYYY-MM-DD` */
  date: string
  summary: string | null
  increase: number
  decrease: number
}

/** ERP 거래처 하나의 미수 또는 미지급 원장입니다. 거래처는 ERP 코드로 가르고, 앱 거래처(Bookkeeping `partners`)와 잇지 않습니다. */
export interface PartnerLedger {
  partnerCode: string
  partnerName: string
  /** 사업연도 시작일의 잔액(전기 이월)입니다. */
  openingBalance: number
  entries: ReadonlyArray<PartnerLedgerEntry>
}

/** 미수·미지급 스냅샷 업로드 본문입니다. */
export interface ReceivablePayableUpload {
  closedThrough: string
  receivables: ReadonlyArray<PartnerLedger>
  payables: ReadonlyArray<PartnerLedger>
}

/** 저장하는 미수·미지급 스냅샷입니다. */
export interface ReceivablePayableSnapshotRecord extends SettlementSnapshotMeta {
  receivables: ReadonlyArray<PartnerLedger>
  payables: ReadonlyArray<PartnerLedger>
}

/** 잔액이 움직인 한 기간의 요약입니다. 기말 잔액 = 기초 잔액 + 증가 − 감소입니다. */
export interface BalanceMovement {
  openingBalance: number
  increase: number
  decrease: number
  closingBalance: number
}

/** 미수 또는 미지급 한쪽의 집계입니다. */
export interface ReceivablePayableSide extends BalanceMovement {
  months: ReadonlyArray<BalanceMovement & { month: string }>
  partners: ReadonlyArray<BalanceMovement & { partnerCode: string; partnerName: string; entryCount: number }>
}
