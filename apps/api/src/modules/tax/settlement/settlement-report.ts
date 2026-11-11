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

/** 결산 보고서 종류입니다. 손익계산서와 자금 흐름이 있습니다. */
export const SettlementReportKind = Schema.Literals(['PROFIT_LOSS', 'CASH_FLOW'])

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
    ]),
    field: Schema.String,
  },
) {}
