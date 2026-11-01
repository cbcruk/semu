import type { PlainDate } from '../../../lib/plain-date.types'
import type { NonTaxableCategory, PayrollRateTable, YearMonth } from './rate-table.types'

/** One step of a calculation, shown behind the `fx` icon of an amount cell and on payslips. */
export interface TraceEntry {
  code: string
  label: string
  amount: number
  /** Human-readable formula with the actual operands, such as `3,000,000 × 4.75%`. */
  formula: string
}

/** How a social insurance premium is deducted: by rate, by the agency's notice, or not at all. */
export type InsuranceMode = 'rate' | 'notice' | 'exempt'

/** Per-insurance deduction setting for one row. */
export interface InsuranceSetting {
  mode: InsuranceMode
  /** Employee premium from the agency notice, used when `mode` is `notice`. */
  noticeAmount?: number
  /** Employer premium from the notice; defaults to the employee notice amount for pension and health. */
  employerNoticeAmount?: number
}

/** Inputs of {@linkcode calculateSocialInsurance}. */
export interface SocialInsuranceInput {
  /** Monthly pay subject to premiums (보수), normally taxable pay. */
  insurablePay: number
  nationalPension: InsuranceSetting & {
    /** Reported 기준소득월액; defaults to `insurablePay`. */
    baseMonthlyIncome?: number
  }
  healthInsurance: InsuranceSetting & {
    /** Reported 보수월액; defaults to `insurablePay`. */
    baseMonthlyIncome?: number
    /** Long-term care premium from the notice when health insurance uses `notice`. */
    longTermCareNoticeAmount?: number
  }
  employmentInsurance: InsuranceSetting & {
    /** `artist` applies the 예술인·노무제공자 employee rate. */
    kind?: 'standard' | 'artist'
  }
  /** 산재보험 employer rate in ppm; defaults to the table's default rate. */
  industrialAccidentRatePpm?: number
  /** 고용안정·직업능력개발 employer rate in ppm, which depends on company size. */
  employerStabilityRatePpm?: number
}

/** Premiums of the four social insurances for one side (employee or employer). */
export interface InsurancePremiums {
  nationalPension: number
  healthInsurance: number
  longTermCare: number
  employmentInsurance: number
  /** Always zero on the employee side. */
  industrialAccident: number
  total: number
}

/** Result of {@linkcode calculateSocialInsurance}. */
export interface SocialInsuranceResult {
  employee: InsurancePremiums
  employer: InsurancePremiums
  trace: TraceEntry[]
}

/** 원천징수 비율 the employee chose for wage income tax (80/100/120%). */
export type WithholdingRatio = 80 | 100 | 120

/** Inputs of the simple wage income tax (간이세액) lookup. */
export interface SimpleTaxInput {
  /** Monthly taxable pay, excluding non-taxable allowances. */
  monthlyTaxablePay: number
  /** 공제대상가족 수 including the employee; at least 1. */
  dependants: number
  /** Number of children aged 8 to 20 among the dependants. */
  childrenAged8To20: number
}

/**
 * Computes the monthly 간이세액 before the withholding ratio.
 *
 * Built-ins are {@linkcode EXACT_FORMULA}, {@linkcode MIDPOINT_FORMULA} and
 * {@linkcode lookupSimpleTaxTable}; a strategy backed by the official table can
 * replace them without touching callers.
 */
export interface SimpleTaxStrategy {
  name: string
  monthlyTax(input: SimpleTaxInput, rates: PayrollRateTable): number
}

/** How wage income tax is withheld, mirroring `INCOME_TAX_CALC_METHOD`. */
export type IncomeTaxMethod = 'tax_table_based' | 'manual_input' | 'none'

/** Wage income tax setting of one row. */
export interface WageIncomeTaxSetting {
  method: IncomeTaxMethod
  dependants: number
  childrenAged8To20: number
  withholdingRatio: WithholdingRatio
  /** Income tax entered by hand when `method` is `manual_input`. */
  manualAmount?: number
  /** 중소기업 취업자 감면 applied monthly (`INCOME_TAX_REDUCTION_APPLICATION_TYPE = payroll`). */
  reduction?: { ratePpm: number; remainingAnnualLimit: number }
}

/** A payment item on a wage row: base pay, allowance or non-taxable benefit. */
export interface PaymentItemInput {
  code: string
  name: string
  amount: number
  /** Statutory non-taxable category; `undefined` for taxable items. */
  nonTaxableCategory?: NonTaxableCategory
  /** Treats the whole amount as non-taxable without a limit, for amounts the caller already classified. */
  preclassifiedNonTaxable?: boolean
  /** Company-set non-taxable limit, applied together with the statutory limit (the smaller wins). */
  companyNonTaxableLimit?: number
  /** Non-taxable amount of this category already used this year, for annual limits. */
  annualNonTaxableUsed?: number
  includeInOrdinaryWage?: boolean
  includeInMinimumWage?: boolean
  /** Whether the item is prorated together with base pay. */
  prorate?: boolean
}

/** A payment line after non-taxable limits are applied. */
export interface PaymentLine {
  code: string
  name: string
  amount: number
  taxableAmount: number
  nonTaxableAmount: number
  formula: string
}

/** A deduction line: social insurance, taxes, or a company deduction item. */
export interface DeductionLine {
  code: string
  name: string
  amount: number
  formula: string
}

/** A company deduction item (선지급금, 동호회비…) entered on a row. */
export interface OtherDeductionInput {
  code: string
  name: string
  amount: number
}

/** Premium multipliers of 연장·야간·휴일·휴일연장 work, from `payroll_terms`. */
export interface PremiumMultipliers {
  overtime: number
  night: number
  holiday: number
  holidayOvertime: number
}

/** Hours worked in a month, from the work sheet. All values are decimal hours. */
export interface WorkHoursInput {
  /** Regular hours paid at the base rate (hourly workers). */
  regularHours?: number
  overtimeHours?: number
  nightHours?: number
  holidayHours?: number
  holidayOvertimeHours?: number
  /** Late arrival, early leave and absence hours deducted from monthly pay. */
  absenceHours?: number
  /** Weeks whose 주휴 is forfeited by absence (monthly pay), deducted at the daily rest hours. */
  weeklyHolidayDeductionDays?: number
}

/** Proration (일할계산) of monthly items. */
export interface ProrationInput {
  method: 'calendar_days' | 'scheduled_days'
  /** Days the employee was employed and paid within the period. */
  payableDays: number
  /** Calendar days of the month, or scheduled work days for `scheduled_days`. */
  totalDays: number
}

/** Fields shared by every wage row. */
interface WageRowBase {
  attributionMonth: YearMonth
  paymentItems: readonly PaymentItemInput[]
  work?: WorkHoursInput
  multipliers: PremiumMultipliers
  /** 월 소정근로시간 including paid weekly rest; 209 for a 40-hour week. */
  monthlyStandardHours: number
  /** 1일 주휴시간, used for 주휴 allowances and deductions. */
  dailyRestHours?: number
  insurance: Omit<SocialInsuranceInput, 'insurablePay'>
  incomeTax: WageIncomeTaxSetting
  otherDeductions?: readonly OtherDeductionInput[]
}

/** A monthly-salaried wage row (`wage-monthly`). */
export interface MonthlyWageRowInput extends WageRowBase {
  incomeType: 'wage_monthly'
  basePay: number
  proration?: ProrationInput
}

/** An hourly-paid wage row (`wage-hourly`). */
export interface HourlyWageRowInput extends WageRowBase {
  incomeType: 'wage_hourly'
  hourlyWage: number
  /** Weeks in the month that earn 주휴수당 (소정근로일 개근 and 15+ hours a week). */
  weeklyHolidayWeeks?: number
}

/** A daily-paid wage row (`wage-daily`), distinct from daily workers. */
export interface DailyWageRowInput extends WageRowBase {
  incomeType: 'wage_daily'
  dailyWage: number
  workedDays: number
  /** 1일 소정근로시간 used to derive the hourly rate; defaults to 8. */
  dailyContractualHours?: number
  weeklyHolidayWeeks?: number
}

/** Any wage row. */
export type WageRowInput = MonthlyWageRowInput | HourlyWageRowInput | DailyWageRowInput

/** A daily worker row (일용근로소득, `daily`). */
export interface DailyWorkerRowInput {
  incomeType: 'daily'
  attributionMonth: YearMonth
  /** Total pay of the row. */
  payAmount: number
  workDays: number
  /** Pay of each work day; when omitted the total is split evenly. */
  dailyPays?: readonly number[]
  /** Average hours per work day, used for the social insurance threshold. */
  averageDailyHours?: number
  insurance: Omit<SocialInsuranceInput, 'insurablePay'>
  otherDeductions?: readonly OtherDeductionInput[]
}

/** Whether a row's amount is before tax (`before_tax`) or the net amount to be grossed up (`after_tax`). */
export type TaxDeductionMode = 'before_tax' | 'after_tax'

/** A business income row (사업소득, `business`). */
export interface BusinessRowInput {
  incomeType: 'business'
  attributionMonth: YearMonth
  payAmount: number
  taxDeductionMode?: TaxDeductionMode
  /** 예술인·노무제공자 employment insurance. */
  employmentInsurance?: { applicable: boolean; insurableEarnings?: number }
  otherDeductions?: readonly OtherDeductionInput[]
}

/** How necessary expenses of other income are determined. */
export type NecessaryExpense = { kind: 'deemed'; ratePpm: number } | { kind: 'actual'; amount: number }

/** An other income row (기타소득, `other`). */
export interface OtherIncomeRowInput {
  incomeType: 'other'
  attributionMonth: YearMonth
  payAmount: number
  necessaryExpense: NecessaryExpense
  /** Income tax rate in ppm; defaults to the table's 20%. */
  taxRatePpm?: number
  taxDeductionMode?: TaxDeductionMode
  otherDeductions?: readonly OtherDeductionInput[]
}

/** Input of {@linkcode calculatePayrollRow}, discriminated by `incomeType`. */
export type PayrollRowInput = WageRowInput | DailyWorkerRowInput | BusinessRowInput | OtherIncomeRowInput

/** Income type of a payroll row, matching the BPO segments with underscores. */
export type PayrollIncomeType = PayrollRowInput['incomeType']

/** Options of {@linkcode calculatePayrollRow}. */
export interface PayrollRowOptions {
  /** Strategy for 간이세액; defaults to {@linkcode MIDPOINT_FORMULA}. */
  simpleTax?: SimpleTaxStrategy
}

/** Warning codes raised without blocking the calculation. */
export type PayrollWarningCode = 'BELOW_MINIMUM_WAGE' | 'NON_TAXABLE_LIMIT_EXCEEDED' | 'DAILY_WORKER_SOCIAL_INSURANCE_REQUIRED'

/** A non-blocking warning attached to a result. */
export interface PayrollWarning {
  code: PayrollWarningCode
  message: string
}

/** Result of {@linkcode calculatePayrollRow}. */
export interface PayrollRowResult {
  incomeType: PayrollIncomeType
  attributionMonth: YearMonth
  /** Effective month of the rate table that was used. */
  rateTable: YearMonth
  payments: PaymentLine[]
  grossPay: number
  taxablePay: number
  nonTaxablePay: number
  insurance: SocialInsuranceResult
  incomeTax: number
  localIncomeTax: number
  deductions: DeductionLine[]
  deductionTotal: number
  netPay: number
  /** Employer share of social insurance, for labour cost reports. */
  employerInsuranceTotal: number
  breakdown: TraceEntry[]
  warnings: PayrollWarning[]
}

/** Inputs of {@linkcode calculateSeverancePay}. */
export interface SeveranceInput {
  joinDate: PlainDate
  /** Last day worked; the retirement date (산정사유 발생일) is the next day. */
  lastWorkDate: PlainDate
  /** Wages paid in the three calendar months before the retirement date. */
  threeMonthWages: number
  /** Days in that three-month period; defaults to {@linkcode averageWagePeriodDays}. */
  threeMonthDays?: number
  /** Annual bonus paid in the last 12 months; 3/12 is added. */
  annualBonus?: number
  /** Unused annual leave pay of the previous year; 3/12 is added. */
  annualLeavePay?: number
  /** 1일 통상임금, used when it exceeds the average daily wage. */
  ordinaryDailyWage?: number
}

/** Result of {@linkcode calculateSeverancePay}. */
export interface SeveranceResult {
  eligible: boolean
  serviceDays: number
  averageDailyWage: number
  /** Whether the ordinary daily wage replaced a lower average daily wage. */
  usedOrdinaryWage: boolean
  severancePay: number
  retirementIncomeTax: number
  localIncomeTax: number
  netPay: number
  breakdown: TraceEntry[]
}
