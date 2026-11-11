import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { CalendarDate, YearMonth } from '../../../shared/time/date-schemas.ts'

const Account = Schema.Struct({
  /** ERP 계정과목 이름(`상품매출`, `직원급여`)입니다. 회사 계정과목표(Bookkeeping)와 잇지 않은 표시용 문자열입니다. */
  name: Schema.String,
  /** 원입니다. 섹션 합계에 더하는 부호로 적습니다. */
  amount: Schema.Int,
})

const SectionAmount = Schema.Struct({
  /** 섹션 합계(원)입니다. 계정이 있으면 계정 금액의 합과 같아야 합니다. */
  amount: Schema.Int,
  accounts: Schema.Array(Account),
})

const InputSections = Schema.Struct({
  /** 매출액 */
  REVENUE: SectionAmount,
  /** 매출원가 */
  COST_OF_SALES: SectionAmount,
  /** 판매비와관리비 */
  SELLING_AND_ADMINISTRATIVE_EXPENSES: SectionAmount,
  /** 영업외수익 */
  NON_OPERATING_INCOME: SectionAmount,
  /** 영업외비용 */
  NON_OPERATING_EXPENSES: SectionAmount,
  /** 법인세등(법인) 또는 소득세등(개인) */
  INCOME_TAXES: SectionAmount,
})

/** `PUT /settlement-reports/profit-loss/{fiscalYear}` 본문입니다. 그 사업연도의 손익 스냅샷을 통째로 바꿉니다. */
export const ProfitLossUploadBody = Schema.Struct({
  /** 결산 기준일(월말)입니다. 이날이 속한 달까지 월별 손익을 빠짐없이 보냅니다. */
  closedThrough: CalendarDate,
  months: Schema.Array(Schema.Struct({ month: YearMonth, sections: InputSections })),
})

const Sections = Schema.Struct({
  REVENUE: SectionAmount,
  COST_OF_SALES: SectionAmount,
  /** 매출총이익 = 매출액 − 매출원가 */
  GROSS_PROFIT: SectionAmount,
  SELLING_AND_ADMINISTRATIVE_EXPENSES: SectionAmount,
  /** 영업이익 = 매출총이익 − 판매비와관리비 */
  OPERATING_INCOME: SectionAmount,
  NON_OPERATING_INCOME: SectionAmount,
  NON_OPERATING_EXPENSES: SectionAmount,
  INCOME_TAXES: SectionAmount,
  /** 당기순이익 = 영업이익 + 영업외수익 − 영업외비용 − 법인세등 */
  NET_INCOME: SectionAmount,
})

/** 결산 손익계산서입니다. 담당자가 올린 스냅샷에서 계산 섹션과 당기 누계를 채웁니다. */
export const ProfitLossReport = Schema.Struct({
  /** 사업연도가 끝나는 해입니다. */
  fiscalYear: Schema.Int,
  /** 사업연도 기간입니다. 세무 설정의 결산월로 정합니다. */
  period: Schema.Struct({ start: CalendarDate, end: CalendarDate }),
  closedThrough: CalendarDate,
  months: Schema.Array(Schema.Struct({ month: YearMonth, sections: Sections })),
  /** 사업연도 첫 달부터 결산 기준일까지의 누계입니다. 계정은 이름으로 묶습니다. */
  total: Sections,
  version: Schema.Int,
  updatedAt: Schema.String,
})

const CashAccountMonth = Schema.Struct({
  /** 유입(원, 0 이상) */
  inflow: Schema.Int,
  /** 유출(원, 0 이상) */
  outflow: Schema.Int,
  /** 월말 잔액(원) = 전월 말 잔액 + 유입 − 유출 */
  closingBalance: Schema.Int,
})

const CashAccounts = Schema.Struct({
  /** 현금 */
  CASH: CashAccountMonth,
  /** 당좌예금 */
  CHECKING_DEPOSIT: CashAccountMonth,
  /** 보통예금 */
  ORDINARY_DEPOSIT: CashAccountMonth,
  /** 제예금(그 밖의 예금) */
  OTHER_DEPOSITS: CashAccountMonth,
})

const OpeningBalances = Schema.Struct({
  CASH: Schema.Int,
  CHECKING_DEPOSIT: Schema.Int,
  ORDINARY_DEPOSIT: Schema.Int,
  OTHER_DEPOSITS: Schema.Int,
})

/** `PUT /settlement-reports/cash-flow/{fiscalYear}` 본문입니다. 그 사업연도의 자금 흐름 스냅샷을 통째로 바꿉니다. */
export const CashFlowUploadBody = Schema.Struct({
  /** 결산 기준일(월말)입니다. 이날이 속한 달까지 월별 자금 흐름을 빠짐없이 보냅니다. */
  closedThrough: CalendarDate,
  /** 사업연도 시작일의 계정별 잔액(기초 잔액)입니다. */
  openingBalances: OpeningBalances,
  months: Schema.Array(Schema.Struct({ month: YearMonth, accounts: CashAccounts })),
})

/** 결산 자금 흐름입니다. 현금성 계정(현금·당좌예금·보통예금·제예금)의 월별 유입·유출·잔액입니다. */
export const CashFlowReport = Schema.Struct({
  fiscalYear: Schema.Int,
  period: Schema.Struct({ start: CalendarDate, end: CalendarDate }),
  closedThrough: CalendarDate,
  openingBalances: OpeningBalances,
  months: Schema.Array(
    Schema.Struct({
      month: YearMonth,
      accounts: CashAccounts,
      /** 네 계정 유입의 합 */
      inflow: Schema.Int,
      /** 네 계정 유출의 합 */
      outflow: Schema.Int,
      /** 순유입 = 유입 − 유출. 음수면 순유출입니다. */
      netInflow: Schema.Int,
      /** 보유자금 = 네 계정 월말 잔액의 합 */
      fundsHeld: Schema.Int,
    }),
  ),
  /** 결산 기준일의 보유자금입니다. 마지막 달의 `fundsHeld`와 같습니다. */
  fundsHeld: Schema.Int,
  version: Schema.Int,
  updatedAt: Schema.String,
})

const BalanceSheetGroups = Schema.Struct({
  /** 유동자산 */
  CURRENT_ASSETS: SectionAmount,
  /** 비유동자산 */
  NON_CURRENT_ASSETS: SectionAmount,
  /** 유동부채 */
  CURRENT_LIABILITIES: SectionAmount,
  /** 비유동부채 */
  NON_CURRENT_LIABILITIES: SectionAmount,
  /** 자본금 */
  CAPITAL_STOCK: SectionAmount,
  /** 자본잉여금 */
  CAPITAL_SURPLUS: SectionAmount,
  /** 자본조정 */
  CAPITAL_ADJUSTMENTS: SectionAmount,
  /** 기타포괄손익누계액 */
  ACCUMULATED_OTHER_COMPREHENSIVE_INCOME: SectionAmount,
  /** 이익잉여금(결손이면 음수) */
  RETAINED_EARNINGS: SectionAmount,
})

const BalanceSheetInputFields = {
  /** `YYYY-MM`. 그 달 말일의 잔액입니다. */
  month: YearMonth,
  groups: BalanceSheetGroups,
  /** 유동자산 중 재고자산(원, 0 이상)입니다. */
  inventories: Schema.Int,
  /** 유동자산 중 매출채권(원, 0 이상)입니다. */
  tradeReceivables: Schema.Int,
}

/** `PUT /settlement-reports/balance-sheet/{fiscalYear}` 본문입니다. 그 사업연도의 재무상태표 스냅샷을 통째로 바꿉니다. */
export const BalanceSheetUploadBody = Schema.Struct({
  /** 결산 기준일(월말)입니다. 이날이 속한 달까지 달마다 월말 재무상태를 빠짐없이 보냅니다. */
  closedThrough: CalendarDate,
  months: Schema.Array(Schema.Struct(BalanceSheetInputFields)),
})

const RatioPpm = Schema.NullOr(Schema.Int)

/** 결산 재무상태표입니다. 달마다 월말 재무상태, 총계, 재무 비율입니다. */
export const BalanceSheetReport = Schema.Struct({
  fiscalYear: Schema.Int,
  period: Schema.Struct({ start: CalendarDate, end: CalendarDate }),
  closedThrough: CalendarDate,
  months: Schema.Array(
    Schema.Struct({
      ...BalanceSheetInputFields,
      totals: Schema.Struct({
        assets: Schema.Int,
        liabilities: Schema.Int,
        equity: Schema.Int,
        /** 부채와자본 총계 = 부채 + 자본. 자산 총계와 같습니다. */
        liabilitiesAndEquity: Schema.Int,
      }),
      /** 재무 비율입니다. ppm(1 = 1,000,000)이고, 분모가 0이거나 그 달 손익계산서가 없으면 `null`입니다. */
      ratios: Schema.Struct({
        /** 자기자본비율 = 자본 / 자산 */
        equityRatioPpm: RatioPpm,
        /** 부채비율 = 부채 / 자본 */
        debtRatioPpm: RatioPpm,
        /** 유동비율 = 유동자산 / 유동부채 */
        currentRatioPpm: RatioPpm,
        /** 총자산순이익률 = 누적 당기순이익 / 자산 */
        returnOnAssetsPpm: RatioPpm,
        /** 자기자본순이익률 = 누적 당기순이익 / 자본 */
        returnOnEquityPpm: RatioPpm,
        /** 총자산회전율 = 누적 매출액 / 자산 */
        totalAssetTurnoverPpm: RatioPpm,
        /** 재고자산회전율 = 누적 매출액 / 재고자산 */
        inventoryTurnoverPpm: RatioPpm,
        /** 매출채권회전율 = 누적 매출액 / 매출채권 */
        receivablesTurnoverPpm: RatioPpm,
      }),
    }),
  ),
  version: Schema.Int,
  updatedAt: Schema.String,
})

const LedgerEntry = Schema.Struct({
  date: CalendarDate,
  /** 적요입니다. */
  summary: Schema.NullOr(Schema.String),
  /** 채권·채무가 늘어난 금액(원, 0 이상) */
  increase: Schema.Int,
  /** 회수·지급한 금액(원, 0 이상) */
  decrease: Schema.Int,
})

const PartnerLedgerBody = Schema.Struct({
  /** ERP 거래처 코드입니다. 앱 거래처(Bookkeeping `partners`)와 잇지 않습니다. */
  partnerCode: Schema.String,
  partnerName: Schema.String,
  /** 사업연도 시작일의 잔액(전기 이월)입니다. */
  openingBalance: Schema.Int,
  entries: Schema.Array(LedgerEntry),
})

/** `PUT /settlement-reports/receivable-payable/{fiscalYear}` 본문입니다. 그 사업연도의 미수·미지급 스냅샷을 통째로 바꿉니다. */
export const ReceivablePayableUploadBody = Schema.Struct({
  /** 결산 기준일(월말)입니다. 거래 날짜는 사업연도 시작일부터 이날까지입니다. */
  closedThrough: CalendarDate,
  /** 거래처별 미수(받을 돈) 원장 */
  receivables: Schema.Array(PartnerLedgerBody),
  /** 거래처별 미지급(줄 돈) 원장 */
  payables: Schema.Array(PartnerLedgerBody),
})

const Movement = {
  openingBalance: Schema.Int,
  increase: Schema.Int,
  decrease: Schema.Int,
  /** 기말 잔액 = 기초 잔액 + 증가 − 감소 */
  closingBalance: Schema.Int,
}

const ReceivablePayableSide = Schema.Struct({
  ...Movement,
  /** 사업연도 첫 달부터 결산 기준일이 속한 달까지 달마다 */
  months: Schema.Array(Schema.Struct({ month: YearMonth, ...Movement })),
  /** 거래처마다. 기초 잔액은 전기 이월, 증가·감소는 사업연도 누계입니다. */
  partners: Schema.Array(
    Schema.Struct({ partnerCode: Schema.String, partnerName: Schema.String, entryCount: Schema.Int, ...Movement }),
  ),
})

/** 결산 미수·미지급입니다. 거래처 원장에서 월별·거래처별 합계를 계산합니다. */
export const ReceivablePayableReport = Schema.Struct({
  fiscalYear: Schema.Int,
  period: Schema.Struct({ start: CalendarDate, end: CalendarDate }),
  closedThrough: CalendarDate,
  receivable: ReceivablePayableSide,
  payable: ReceivablePayableSide,
  version: Schema.Int,
  updatedAt: Schema.String,
})

/** 거래처 하나의 원장입니다. 거래는 날짜 순이고, 거래마다 누적 잔액이 붙습니다. */
export const PartnerLedgerReport = Schema.Struct({
  fiscalYear: Schema.Int,
  kind: Schema.Literals(['RECEIVABLE', 'PAYABLE']),
  partnerCode: Schema.String,
  partnerName: Schema.String,
  openingBalance: Schema.Int,
  closingBalance: Schema.Int,
  entries: Schema.Array(Schema.Struct({ ...LedgerEntry.fields, balance: Schema.Int })),
})

/** 결산 보고서 종류입니다. 손익계산서, 자금 흐름, 재무상태표, 미수·미지급이 있습니다. */
export const SettlementReportKind = Schema.Literals(['PROFIT_LOSS', 'CASH_FLOW', 'BALANCE_SHEET', 'RECEIVABLE_PAYABLE'])

/** 결산 데이터가 있는 보고서·사업연도 하나입니다. 화면의 연도 선택기에 씁니다(현행 `closing_list`). */
export const SettlementReportAvailability = Schema.Struct({
  report: SettlementReportKind,
  fiscalYear: Schema.Int,
  closedThrough: CalendarDate,
  updatedAt: Schema.String,
})

/** `GET /settlement-reports` 응답입니다. 비어 있으면 화면이 예시 데이터를 보여 줍니다. */
export const SettlementReportList = Schema.Struct({ items: Schema.Array(SettlementReportAvailability) })

/** 그 사업연도의 결산 데이터를 아직 올리지 않았습니다. */
export class SettlementReportNotFound extends HttpApiError.Problem<SettlementReportNotFound>()(
  'SettlementReportNotFound',
  { type: problemType('SETTLEMENT_REPORT_NOT_FOUND'), status: 404, title: 'Settlement report not found' },
  { code: Schema.tag('SETTLEMENT_REPORT_NOT_FOUND') },
) {}

/** 그 사업연도 미수·미지급 스냅샷에 이 ERP 거래처가 없습니다. */
export class SettlementPartnerNotFound extends HttpApiError.Problem<SettlementPartnerNotFound>()(
  'SettlementPartnerNotFound',
  { type: problemType('SETTLEMENT_PARTNER_NOT_FOUND'), status: 404, title: 'Settlement partner not found' },
  { code: Schema.tag('SETTLEMENT_PARTNER_NOT_FOUND') },
) {}

/** 결산 스냅샷이 사업연도·결산 기준일이나 손익 규칙에 맞지 않습니다. 이유는 `reason`, 걸린 위치는 `field`입니다. */
export class SettlementSnapshotInvalid extends HttpApiError.Problem<SettlementSnapshotInvalid>()(
  'SettlementSnapshotInvalid',
  { type: problemType('SETTLEMENT_SNAPSHOT_INVALID'), status: 422, title: 'Settlement snapshot is not valid' },
  {
    code: Schema.tag('SETTLEMENT_SNAPSHOT_INVALID'),
    reason: Schema.Literals([
      'CLOSED_THROUGH_OUT_OF_PERIOD',
      'CLOSED_THROUGH_IN_FUTURE',
      'CLOSED_THROUGH_NOT_MONTH_END',
      'MONTH_OUT_OF_RANGE',
      'MONTH_DUPLICATED',
      'MONTH_MISSING',
      'ACCOUNT_NAME_BLANK',
      'ACCOUNT_DUPLICATED',
      'SECTION_TOTAL_MISMATCH',
      'CASH_AMOUNT_NEGATIVE',
      'CASH_BALANCE_MISMATCH',
      'BALANCE_SHEET_UNBALANCED',
      'CURRENT_ASSET_COMPONENT_INVALID',
      'PARTNER_BLANK',
      'PARTNER_DUPLICATED',
      'PARTNER_CODE_RESERVED',
      'ENTRY_DATE_OUT_OF_RANGE',
      'ENTRY_AMOUNT_NEGATIVE',
    ]),
    field: Schema.String,
  },
) {}
