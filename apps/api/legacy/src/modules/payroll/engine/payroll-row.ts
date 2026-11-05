import type {
  BusinessRowInput,
  DailyWorkerRowInput,
  DeductionLine,
  OtherDeductionInput,
  OtherIncomeRowInput,
  PaymentItemInput,
  PaymentLine,
  PayrollIncomeType,
  PayrollRowInput,
  PayrollRowOptions,
  PayrollRowResult,
  PayrollWarning,
  SocialInsuranceInput,
  SocialInsuranceResult,
  TraceEntry,
  WageRowInput,
} from './engine.types'
import { formatWon, sum, toMinutes } from './engine.utils'
import { splitNonTaxable } from './non-taxable'
import type { PayrollRateTable, YearMonth } from './rate-table.types'
import { calculateSocialInsurance } from './social-insurance'
import { calculateWageIncomeTax, MIDPOINT_FORMULA } from './wage-income-tax'
import { grossUpFromNet, withholdBusinessIncome, withholdDailyWorker, withholdOtherIncome, type WithholdingResult } from './withholding'
import {
  dailyWorkerSocialInsuranceRequired,
  isBelowMinimumWage,
  monthlyWageRate,
  payForHours,
  premiumPay,
  type PremiumKind,
  prorate,
  type WageRate,
  weeklyHolidayAllowance,
} from './working-time'

const PREMIUM_ITEMS: readonly { kind: PremiumKind; hours: 'overtimeHours' | 'nightHours' | 'holidayHours' | 'holidayOvertimeHours'; code: string; name: string }[] = [
  { kind: 'overtime', hours: 'overtimeHours', code: 'overtime_pay', name: '연장근로수당' },
  { kind: 'night', hours: 'nightHours', code: 'night_pay', name: '야간근로수당' },
  { kind: 'holiday', hours: 'holidayHours', code: 'holiday_pay', name: '휴일근로수당' },
  { kind: 'holidayOvertime', hours: 'holidayOvertimeHours', code: 'holiday_overtime_pay', name: '휴일연장근로수당' },
]

const EXEMPT_INSURANCE: Omit<SocialInsuranceInput, 'insurablePay'> = {
  nationalPension: { mode: 'exempt' },
  healthInsurance: { mode: 'exempt' },
  employmentInsurance: { mode: 'exempt' },
}

/**
 * Calculates one payroll row of any income type: payments, insurance, taxes, deductions and net pay.
 *
 * This is the entry point the payroll cards, the BPO inputs and the salary
 * calculator call. It is pure: rates come in as a resolved
 * {@linkcode PayrollRateTable} (see {@linkcode resolveRateTable}) and nothing
 * is read from the database. Dispatches to {@linkcode calculateWageRow},
 * {@linkcode calculateDailyWorkerRow}, {@linkcode calculateBusinessRow} and
 * {@linkcode calculateOtherIncomeRow}.
 *
 * @example A monthly salary with a meal allowance
 * ```ts
 * import { calculatePayrollRow } from './payroll-row'
 * import { RATES_2026_01 } from './rate-table-2026'
 * import { MULTIPLIERS_FIVE_OR_MORE } from './working-time'
 *
 * const row = calculatePayrollRow(
 *   {
 *     incomeType: 'wage_monthly',
 *     attributionMonth: '2026-03',
 *     basePay: 3_000_000,
 *     paymentItems: [{ code: 'meal', name: '식대', amount: 200_000, nonTaxableCategory: 'meal' }],
 *     multipliers: MULTIPLIERS_FIVE_OR_MORE,
 *     monthlyStandardHours: 209,
 *     insurance: {
 *       nationalPension: { mode: 'rate' },
 *       healthInsurance: { mode: 'rate' },
 *       employmentInsurance: { mode: 'rate' },
 *     },
 *     incomeTax: { method: 'tax_table_based', dependants: 1, childrenAged8To20: 0, withholdingRatio: 100 },
 *   },
 *   RATES_2026_01,
 * )
 * row.netPay // 3,200,000 − 291,520 insurance − 60,380 income tax − 6,030 local tax = 2,842,070
 * ```
 */
export function calculatePayrollRow(input: PayrollRowInput, rates: PayrollRateTable, options: PayrollRowOptions = {}): PayrollRowResult {
  switch (input.incomeType) {
    case 'wage_monthly':
    case 'wage_hourly':
    case 'wage_daily':
      return calculateWageRow(input, rates, options)
    case 'daily':
      return calculateDailyWorkerRow(input, rates)
    case 'business':
      return calculateBusinessRow(input, rates)
    case 'other':
      return calculateOtherIncomeRow(input, rates)
  }
}

/**
 * Calculates a wage row (근로소득: monthly, hourly or daily pay).
 *
 * Order: base pay (prorated for monthly pay) → 주휴수당 for hourly and daily
 * pay → 연장·야간·휴일·휴일연장 premiums at the configured multipliers →
 * 근태공제 for monthly pay → payment items → non-taxable limits → social
 * insurance on taxable pay → 간이세액 and local tax → company deductions.
 * The premium rate is the 통상임금 (base pay plus items flagged for ordinary
 * wage, unprorated) over the monthly standard hours; for hourly pay it is the
 * hourly wage. A rate below the minimum wage adds a warning.
 */
export function calculateWageRow(input: WageRowInput, rates: PayrollRateTable, options: PayrollRowOptions = {}): PayrollRowResult {
  const work = input.work ?? {}
  const dailyRestHours = input.dailyRestHours ?? 8
  const generated: PaymentItemInput[] = []
  const formulas = new Map<string, string>()
  const warnings: PayrollWarning[] = []
  let rate: WageRate
  let minimumWageRate: WageRate

  const ordinaryItems = sum(input.paymentItems.filter((item) => item.includeInOrdinaryWage === true).map((item) => item.amount))
  const minimumItems = sum(input.paymentItems.filter((item) => item.includeInMinimumWage === true).map((item) => item.amount))

  if (input.incomeType === 'wage_monthly') {
    rate = monthlyWageRate(input.basePay + ordinaryItems, input.monthlyStandardHours)
    minimumWageRate = monthlyWageRate(input.basePay + minimumItems, input.monthlyStandardHours)
    const base = input.proration === undefined ? input.basePay : prorate(input.basePay, input.proration)
    generated.push({ code: 'base_pay', name: '기본급', amount: base })
    formulas.set(
      'base_pay',
      input.proration === undefined
        ? formatWon(base)
        : `${formatWon(input.basePay)} × ${input.proration.payableDays} ÷ ${input.proration.totalDays} (일할계산)`,
    )
  } else if (input.incomeType === 'wage_hourly') {
    rate = { amount: input.hourlyWage, perMinutes: 60 }
    minimumWageRate = rate
    const hours = work.regularHours ?? 0
    generated.push({ code: 'base_pay', name: '기본급', amount: payForHours(rate, hours) })
    formulas.set('base_pay', `시급 ${formatWon(input.hourlyWage)} × ${hours}시간`)
  } else {
    const dailyHours = input.dailyContractualHours ?? 8
    rate = { amount: input.dailyWage, perMinutes: toMinutes(dailyHours) }
    minimumWageRate = rate
    generated.push({ code: 'base_pay', name: '기본급', amount: input.dailyWage * input.workedDays })
    formulas.set('base_pay', `일급 ${formatWon(input.dailyWage)} × ${input.workedDays}일`)
  }

  if (input.incomeType !== 'wage_monthly' && (input.weeklyHolidayWeeks ?? 0) > 0) {
    const amount = weeklyHolidayAllowance(rate, dailyRestHours, input.weeklyHolidayWeeks ?? 0)
    generated.push({ code: 'weekly_holiday_pay', name: '주휴수당', amount })
    formulas.set('weekly_holiday_pay', `통상시급 × 주휴 ${dailyRestHours}시간 × ${input.weeklyHolidayWeeks ?? 0}주`)
  }

  for (const premium of PREMIUM_ITEMS) {
    const hours = work[premium.hours] ?? 0
    const multiplier = input.multipliers[premium.kind]
    const amount = premiumPay(rate, hours, multiplier)
    if (amount === 0) continue
    generated.push({ code: premium.code, name: premium.name, amount })
    formulas.set(premium.code, `통상시급 × ${hours}시간 × ${multiplier}`)
  }

  if (input.incomeType === 'wage_monthly') {
    const absenceHours = (work.absenceHours ?? 0) + (work.weeklyHolidayDeductionDays ?? 0) * dailyRestHours
    const amount = payForHours(rate, absenceHours)
    if (amount > 0) {
      generated.push({ code: 'attendance_deduction', name: '근태공제', amount: -amount })
      formulas.set('attendance_deduction', `−통상시급 × ${absenceHours}시간`)
    }
  }

  const proration = input.incomeType === 'wage_monthly' ? input.proration : undefined
  const items = input.paymentItems.map((item) =>
    item.prorate === true && proration !== undefined ? { ...item, amount: prorate(item.amount, proration) } : item,
  )

  const split = splitNonTaxable([...generated, ...items], rates)
  warnings.push(...split.warnings)
  const payments = split.lines.map((line) => (formulas.has(line.code) ? { ...line, formula: formulas.get(line.code) ?? line.formula } : line))
  const taxablePay = Math.max(0, sum(payments.map((line) => line.taxableAmount)))

  if (isBelowMinimumWage(minimumWageRate, rates)) {
    warnings.push({
      code: 'BELOW_MINIMUM_WAGE',
      message: `The hourly equivalent is below the ${rates.effectiveFrom.slice(0, 4)} minimum wage of ${formatWon(rates.minimumWage.hourly)} won.`,
    })
  }

  const insurance = calculateSocialInsurance({ ...input.insurance, insurablePay: taxablePay }, rates)
  const tax = calculateWageIncomeTax(taxablePay, input.incomeTax, rates, options.simpleTax ?? MIDPOINT_FORMULA)
  return finalize({
    incomeType: input.incomeType,
    attributionMonth: input.attributionMonth,
    rates,
    payments,
    taxablePay,
    insurance,
    taxTrace: tax.trace,
    incomeTax: tax.incomeTax,
    localIncomeTax: tax.localIncomeTax,
    withholdTax: input.incomeTax.method !== 'none',
    otherDeductions: input.otherDeductions ?? [],
    extraBreakdown: [],
    warnings,
  })
}

/**
 * Calculates a daily worker row (일용근로소득).
 *
 * Employment insurance follows the row's setting (normally `rate`). National
 * pension and health insurance apply only when the caller enables them; a
 * warning is raised when the 8-day / 60-hour threshold is met but they are exempt.
 */
export function calculateDailyWorkerRow(input: DailyWorkerRowInput, rates: PayrollRateTable): PayrollRowResult {
  const warnings: PayrollWarning[] = []
  const totalHours = (input.averageDailyHours ?? 0) * input.workDays
  if (
    dailyWorkerSocialInsuranceRequired(input.workDays, totalHours, rates) &&
    (input.insurance.nationalPension.mode === 'exempt' || input.insurance.healthInsurance.mode === 'exempt')
  ) {
    warnings.push({
      code: 'DAILY_WORKER_SOCIAL_INSURANCE_REQUIRED',
      message: `Daily workers with ${rates.dailyWorker.socialInsuranceMinDays}+ days or ${rates.dailyWorker.socialInsuranceMinHours}+ hours a month must join the national pension and health insurance.`,
    })
  }
  const payments: PaymentLine[] = [
    {
      code: 'daily_pay',
      name: '일용근로소득',
      amount: input.payAmount,
      taxableAmount: input.payAmount,
      nonTaxableAmount: 0,
      formula: `${formatWon(input.payAmount)} (${input.workDays}일)`,
    },
  ]
  const insurance = calculateSocialInsurance({ ...input.insurance, insurablePay: input.payAmount }, rates)
  const tax = withholdDailyWorker(input.payAmount, input.workDays, input.dailyPays, rates)
  return finalizeWithholding(input.incomeType, input.attributionMonth, rates, payments, input.payAmount, insurance, tax, input.otherDeductions ?? [], warnings)
}

/**
 * Calculates a business income row (사업소득): 3% income tax and 0.3% local tax.
 *
 * With `after_tax`, `payAmount` is the net amount and the gross is found by
 * {@linkcode grossUpFromNet}. 예술인·노무제공자 employment insurance is deducted
 * at the artist rate on `insurableEarnings` (default: the gross pay).
 */
export function calculateBusinessRow(input: BusinessRowInput, rates: PayrollRateTable): PayrollRowResult {
  const insuranceOf = (gross: number): SocialInsuranceResult =>
    calculateSocialInsurance(
      {
        ...EXEMPT_INSURANCE,
        employmentInsurance: { mode: input.employmentInsurance?.applicable === true ? 'rate' : 'exempt', kind: 'artist' },
        insurablePay: input.employmentInsurance?.insurableEarnings ?? gross,
        industrialAccidentRatePpm: 0,
      },
      rates,
    )
  const netOf = (gross: number): number => {
    const tax = withholdBusinessIncome(gross, rates)
    return gross - tax.incomeTax - tax.localIncomeTax - insuranceOf(gross).employee.total
  }
  const gross =
    input.taxDeductionMode === 'after_tax' ? grossUpFromNet(input.payAmount, netOf, rates.businessIncome.ratePpm * 1.1) : input.payAmount
  const payments: PaymentLine[] = [
    { code: 'business_pay', name: '사업소득', amount: gross, taxableAmount: gross, nonTaxableAmount: 0, formula: grossFormula(input.taxDeductionMode, input.payAmount, gross) },
  ]
  return finalizeWithholding(
    input.incomeType,
    input.attributionMonth,
    rates,
    payments,
    gross,
    insuranceOf(gross),
    withholdBusinessIncome(gross, rates),
    input.otherDeductions ?? [],
    [],
  )
}

/**
 * Calculates an other income row (기타소득).
 *
 * `taxablePay` of the result is the 기타소득금액 (payment less necessary
 * expenses), and the expenses appear in the breakdown.
 */
export function calculateOtherIncomeRow(input: OtherIncomeRowInput, rates: PayrollRateTable): PayrollRowResult {
  const netOf = (gross: number): number => {
    const tax = withholdOtherIncome(gross, input.necessaryExpense, input.taxRatePpm, rates)
    return gross - tax.incomeTax - tax.localIncomeTax
  }
  const effectivePpm = Math.round(((input.taxRatePpm ?? rates.otherIncome.ratePpm) * 1.1 * (input.necessaryExpense.kind === 'deemed' ? 1_000_000 - input.necessaryExpense.ratePpm : 1_000_000)) / 1_000_000)
  const gross = input.taxDeductionMode === 'after_tax' ? grossUpFromNet(input.payAmount, netOf, effectivePpm) : input.payAmount
  const tax = withholdOtherIncome(gross, input.necessaryExpense, input.taxRatePpm, rates)
  const expense = tax.trace.find((entry) => entry.code === 'necessary_expense')?.amount ?? 0
  const payments: PaymentLine[] = [
    { code: 'other_pay', name: '기타소득', amount: gross, taxableAmount: gross, nonTaxableAmount: 0, formula: grossFormula(input.taxDeductionMode, input.payAmount, gross) },
  ]
  return finalizeWithholding(
    input.incomeType,
    input.attributionMonth,
    rates,
    payments,
    gross - expense,
    calculateSocialInsurance({ ...EXEMPT_INSURANCE, insurablePay: 0, industrialAccidentRatePpm: 0 }, rates),
    tax,
    input.otherDeductions ?? [],
    [],
  )
}

interface FinalizeInput {
  incomeType: PayrollIncomeType
  attributionMonth: YearMonth
  rates: PayrollRateTable
  payments: PaymentLine[]
  taxablePay: number
  insurance: SocialInsuranceResult
  taxTrace: TraceEntry[]
  incomeTax: number
  localIncomeTax: number
  withholdTax: boolean
  otherDeductions: readonly OtherDeductionInput[]
  extraBreakdown: TraceEntry[]
  warnings: PayrollWarning[]
}

function finalizeWithholding(
  incomeType: PayrollIncomeType,
  attributionMonth: YearMonth,
  rates: PayrollRateTable,
  payments: PaymentLine[],
  taxablePay: number,
  insurance: SocialInsuranceResult,
  tax: WithholdingResult,
  otherDeductions: readonly OtherDeductionInput[],
  warnings: PayrollWarning[],
): PayrollRowResult {
  return finalize({
    incomeType,
    attributionMonth,
    rates,
    payments,
    taxablePay,
    insurance,
    taxTrace: tax.trace.filter((entry) => entry.code === 'income_tax' || entry.code === 'local_income_tax'),
    incomeTax: tax.incomeTax,
    localIncomeTax: tax.localIncomeTax,
    withholdTax: true,
    otherDeductions,
    extraBreakdown: tax.trace.filter((entry) => entry.code !== 'income_tax' && entry.code !== 'local_income_tax'),
    warnings,
  })
}

function finalize(input: FinalizeInput): PayrollRowResult {
  const grossPay = sum(input.payments.map((line) => line.amount))
  const nonTaxablePay = sum(input.payments.map((line) => line.nonTaxableAmount))
  const deductions: DeductionLine[] = input.insurance.trace.map((entry) => ({ code: entry.code, name: entry.label, amount: entry.amount, formula: entry.formula }))
  if (input.withholdTax) {
    for (const entry of input.taxTrace) deductions.push({ code: entry.code, name: entry.label, amount: entry.amount, formula: entry.formula })
  }
  for (const item of input.otherDeductions) deductions.push({ code: item.code, name: item.name, amount: item.amount, formula: formatWon(item.amount) })
  const deductionTotal = sum(deductions.map((line) => line.amount))
  const breakdown: TraceEntry[] = [
    ...input.payments.map((line) => ({ code: line.code, label: line.name, amount: line.amount, formula: line.formula })),
    ...input.extraBreakdown,
    ...deductions.map((line) => ({ code: line.code, label: line.name, amount: line.amount, formula: line.formula })),
  ]
  return {
    incomeType: input.incomeType,
    attributionMonth: input.attributionMonth,
    rateTable: input.rates.effectiveFrom,
    payments: input.payments,
    grossPay,
    taxablePay: input.taxablePay,
    nonTaxablePay,
    insurance: input.insurance,
    incomeTax: input.withholdTax ? input.incomeTax : 0,
    localIncomeTax: input.withholdTax ? input.localIncomeTax : 0,
    deductions,
    deductionTotal,
    netPay: grossPay - deductionTotal,
    employerInsuranceTotal: input.insurance.employer.total,
    breakdown,
    warnings: input.warnings,
  }
}

function grossFormula(mode: BusinessRowInput['taxDeductionMode'], entered: number, gross: number): string {
  return mode === 'after_tax' ? `세후 ${formatWon(entered)} 역산 → ${formatWon(gross)}` : formatWon(gross)
}
