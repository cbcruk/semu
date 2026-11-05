import { Schema } from 'effect'
import { CalendarDate, CalendarMonth, Won } from '../common/wire.ts'

const PlLine = Schema.Literals([
  'REVENUE',
  'COGS',
  'SGA',
  'NON_OPERATING_INCOME',
  'NON_OPERATING_EXPENSE',
  'INCOME_TAX',
])

const PlFiguresFields = {
  revenueAmount: Won,
  costOfSalesAmount: Won,
  grossProfitAmount: Won,
  sgaAmount: Won,
  operatingProfitAmount: Won,
  nonOperatingIncomeAmount: Won,
  nonOperatingExpenseAmount: Won,
  incomeTaxAmount: Won,
  netIncomeAmount: Won,
  /** 줄 아래 보고서 계정(2단계)별 금액입니다. */
  breakdown: Schema.Array(Schema.Struct({ line: PlLine, reportName: Schema.String, amount: Won })),
}

/** 한 기간의 손익입니다. 비용 줄은 양수입니다. */
export const PlFigures = Schema.Struct(PlFiguresFields)

/** 실시간 손익입니다. 분류된 증빙·입출금으로 계산하는 관리용 숫자이고 결산 손익과 다릅니다. */
export const RealtimeProfitLoss = Schema.Struct({
  year: Schema.Int,
  basis: Schema.Literals(['SUPPLY', 'TOTAL']),
  includeBank: Schema.Boolean,
  cumulative: Schema.Boolean,
  months: Schema.Array(Schema.Struct({ month: CalendarMonth, ...PlFiguresFields })),
  total: PlFigures,
  /** 손익에 들어가지 못한 미분류 건수입니다. */
  unclassifiedCount: Schema.Struct({ sales: Schema.Int, purchase: Schema.Int, bank: Schema.Int }),
})

/** 기간 자금 흐름입니다. 출금은 음수입니다. */
export const CashFlowFigures = Schema.Struct({
  openingAmount: Won,
  depositAmount: Won,
  withdrawalAmount: Won,
  /** 마감 − 시작 − 입금 − 출금입니다. 이자 결산·수집 누락·외화 환산 차이입니다. */
  otherChangeAmount: Won,
  closingAmount: Won,
})

/** 하루 자금 현황입니다. 자금 현황에 넣는 입출금·외화 계좌만 셉니다. */
export const CashStatus = Schema.Struct({
  date: CalendarDate,
  figures: CashFlowFigures,
  byAccountTitle: Schema.Array(
    Schema.Struct({
      direction: Schema.Literals(['DEPOSIT', 'WITHDRAWAL']),
      /** 계정과목 ID 또는 `UNCLASSIFIED`입니다. */
      key: Schema.String,
      name: Schema.String,
      amount: Won,
      count: Schema.Int,
    }),
  ),
})

/** 홈 경영 현황입니다. 현행 `/home/summary-cards`를 리소스로 바꿨습니다. */
export const HomeSummary = Schema.Struct({
  date: CalendarDate,
  profitLoss: Schema.Struct({ month: CalendarMonth, revenueAmount: Won, netIncomeAmount: Won }),
  cash: Schema.Struct({ closingAmount: Won }),
  vat: Schema.Struct({
    periodStart: CalendarDate,
    periodEnd: CalendarDate,
    estimatedTaxAmount: Won,
    dueDate: CalendarDate,
    daysUntilDue: Schema.Int,
  }),
  giros: Schema.Struct({ todoCount: Schema.Int, todoAmount: Won }),
})

const IncomeTypeAmounts = Schema.Struct({
  wageAmount: Won,
  dailyWageAmount: Won,
  businessIncomeAmount: Won,
  otherIncomeAmount: Won,
})

/** 인건비 보고서입니다. Payroll이 마감한 급여대장을 그대로 싣습니다. */
export const LaborCostReport = Schema.Struct({
  year: Schema.Int,
  months: Schema.Array(
    Schema.Struct({
      month: CalendarMonth,
      amounts: IncomeTypeAmounts,
      paidHeadcount: IncomeTypeAmounts,
      employedCount: Schema.Int,
      joinedCount: Schema.Int,
      leftCount: Schema.Int,
    }),
  ),
})
