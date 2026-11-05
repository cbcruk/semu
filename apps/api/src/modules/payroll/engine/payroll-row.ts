import { formatHours, formatPpm, formatWon, sum } from './engine-math.ts'
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
  PremiumMultipliers,
  SocialInsuranceInput,
  SocialInsuranceResult,
  TaxDeductionMode,
  TraceEntry,
  WageRowInput,
  WorkMinutesInput,
} from './engine.types.ts'
import { splitNonTaxable } from './non-taxable.ts'
import type { PayrollRateTable, YearMonth } from './rate-table.types.ts'
import { calculateSocialInsurance } from './social-insurance.ts'
import { calculateWageIncomeTax, MIDPOINT_FORMULA } from './wage-income-tax.ts'
import type { WithholdingResult } from './withholding.ts'
import { grossUpFromNet, withholdBusinessIncome, withholdDailyWorker, withholdOtherIncome } from './withholding.ts'
import type { WageRate } from './working-time.ts'
import {
  dailyWorkerSocialInsuranceRequired,
  isBelowMinimumWage,
  monthlyWageRate,
  payForMinutes,
  premiumPay,
  prorate,
  weeklyHolidayAllowance,
} from './working-time.ts'

interface PremiumItem {
  multiplier: keyof PremiumMultipliers
  minutes: keyof WorkMinutesInput
  code: string
  name: string
}

const PREMIUM_ITEMS: readonly PremiumItem[] = [
  { multiplier: 'overtimeRatePpm', minutes: 'overtimeMinutes', code: 'OVERTIME_PAY', name: '연장근로수당' },
  { multiplier: 'nightRatePpm', minutes: 'nightMinutes', code: 'NIGHT_PAY', name: '야간근로수당' },
  { multiplier: 'holidayRatePpm', minutes: 'holidayMinutes', code: 'HOLIDAY_PAY', name: '휴일근로수당' },
  {
    multiplier: 'holidayOvertimeRatePpm',
    minutes: 'holidayOvertimeMinutes',
    code: 'HOLIDAY_OVERTIME_PAY',
    name: '휴일연장근로수당',
  },
]

const EXEMPT_INSURANCE: Omit<SocialInsuranceInput, 'insurablePay'> = {
  nationalPension: { mode: 'EXEMPT' },
  healthInsurance: { mode: 'EXEMPT' },
  employmentInsurance: { mode: 'EXEMPT' },
}

const DEFAULT_DAILY_REST_MINUTES = 8 * 60

/**
 * 소득 구분에 상관없이 급여 행 하나를 계산합니다. 지급, 4대보험, 세금, 공제, 차인지급액을 돌려줍니다.
 *
 * 급여대장 행, 급여 계산기, 퇴직금 정산이 모두 이 함수를 부릅니다. 순수 함수라 기준표는
 * {@link resolveRateTable}로 고른 것을 받고 저장소를 읽지 않습니다.
 *
 * @example 식대가 있는 월급
 * ```ts
 * const row = calculatePayrollRow(
 *   {
 *     incomeType: 'WAGE_MONTHLY',
 *     attributionMonth: '2026-03',
 *     basePay: 3_000_000,
 *     paymentItems: [{ code: 'MEAL', name: '식대', amount: 200_000, nonTaxableCategory: 'MEAL' }],
 *     multipliers: MULTIPLIERS_FIVE_OR_MORE,
 *     monthlyStandardHours: 209,
 *     insurance: { nationalPension: { mode: 'RATE' }, healthInsurance: { mode: 'RATE' }, employmentInsurance: { mode: 'RATE' } },
 *     incomeTax: { method: 'TAX_TABLE', dependants: 1, childrenAged8To20: 0, withholdingRatePpm: 1_000_000 },
 *   },
 *   RATES_2026_01,
 * )
 * row.netPay // 3,200,000 − 291,520 − 60,380 − 6,030 = 2,842,070
 * ```
 */
export function calculatePayrollRow(
  input: PayrollRowInput,
  rates: PayrollRateTable,
  options: PayrollRowOptions = {},
): PayrollRowResult {
  switch (input.incomeType) {
    case 'WAGE_MONTHLY':
    case 'WAGE_HOURLY':
    case 'WAGE_DAILY':
      return calculateWageRow(input, rates, options)
    case 'DAILY':
      return calculateDailyWorkerRow(input, rates)
    case 'BUSINESS':
      return calculateBusinessRow(input, rates)
    case 'OTHER':
      return calculateOtherIncomeRow(input, rates)
  }
}

/**
 * 근로소득 행(월급·시급·일급)을 계산합니다.
 *
 * 순서: 기본급(월급은 일할) → 시급·일급의 주휴수당 → 연장·야간·휴일·휴일연장 가산수당 → 월급의 근태공제 →
 * 지급 항목 → 비과세 한도 → 과세 급여 기준 4대보험 → 간이세액·지방소득세 → 회사 공제 항목.
 * 가산수당 단가는 통상임금(기본급 + 통상임금 포함 항목, 일할 전) ÷ 월 소정근로시간이고, 시급제는 시급입니다.
 * 최저임금 포함 항목으로 환산한 시급이 최저시급보다 낮으면 경고를 붙입니다.
 */
export function calculateWageRow(
  input: WageRowInput,
  rates: PayrollRateTable,
  options: PayrollRowOptions = {},
): PayrollRowResult {
  const work = input.work ?? {}
  const dailyRestMinutes = input.dailyRestMinutes ?? DEFAULT_DAILY_REST_MINUTES
  const generated: PaymentItemInput[] = []
  const formulas = new Map<string, string>()
  const warnings: PayrollWarning[] = []
  let rate: WageRate
  let minimumWageRate: WageRate

  const ordinaryItems = sum(
    input.paymentItems.filter((item) => item.includeInOrdinaryWage === true).map((item) => item.amount),
  )
  const minimumItems = sum(
    input.paymentItems.filter((item) => item.includeInMinimumWage === true).map((item) => item.amount),
  )

  if (input.incomeType === 'WAGE_MONTHLY') {
    rate = monthlyWageRate(input.basePay + ordinaryItems, input.monthlyStandardHours)
    minimumWageRate = monthlyWageRate(input.basePay + minimumItems, input.monthlyStandardHours)
    const base = input.proration === undefined ? input.basePay : prorate(input.basePay, input.proration)
    generated.push({ code: 'BASE_PAY', name: '기본급', amount: base })
    formulas.set(
      'BASE_PAY',
      input.proration === undefined
        ? formatWon(base)
        : `${formatWon(input.basePay)} × ${input.proration.payableDays} ÷ ${input.proration.totalDays} (일할계산)`,
    )
  } else if (input.incomeType === 'WAGE_HOURLY') {
    rate = { amount: input.hourlyWage, perMinutes: 60 }
    minimumWageRate = rate
    const minutes = work.regularMinutes ?? 0
    generated.push({ code: 'BASE_PAY', name: '기본급', amount: payForMinutes(rate, minutes) })
    formulas.set('BASE_PAY', `시급 ${formatWon(input.hourlyWage)} × ${formatHours(minutes)}시간`)
  } else {
    rate = { amount: input.dailyWage, perMinutes: input.dailyContractualMinutes ?? 8 * 60 }
    minimumWageRate = rate
    generated.push({ code: 'BASE_PAY', name: '기본급', amount: input.dailyWage * input.workedDays })
    formulas.set('BASE_PAY', `일급 ${formatWon(input.dailyWage)} × ${input.workedDays}일`)
  }

  if (input.incomeType !== 'WAGE_MONTHLY' && (input.weeklyHolidayWeeks ?? 0) > 0) {
    const weeks = input.weeklyHolidayWeeks ?? 0
    generated.push({
      code: 'WEEKLY_HOLIDAY_PAY',
      name: '주휴수당',
      amount: weeklyHolidayAllowance(rate, dailyRestMinutes, weeks),
    })
    formulas.set('WEEKLY_HOLIDAY_PAY', `통상시급 × 주휴 ${formatHours(dailyRestMinutes)}시간 × ${weeks}주`)
  }

  for (const premium of PREMIUM_ITEMS) {
    const minutes = work[premium.minutes] ?? 0
    const multiplier = input.multipliers[premium.multiplier]
    const amount = premiumPay(rate, minutes, multiplier)
    if (amount === 0) continue
    generated.push({ code: premium.code, name: premium.name, amount })
    formulas.set(premium.code, `통상시급 × ${formatHours(minutes)}시간 × ${formatPpm(multiplier)}`)
  }

  if (input.incomeType === 'WAGE_MONTHLY') {
    const absenceMinutes = (work.absenceMinutes ?? 0) + (work.weeklyHolidayDeductionDays ?? 0) * dailyRestMinutes
    const amount = payForMinutes(rate, absenceMinutes)
    if (amount > 0) {
      generated.push({ code: 'ATTENDANCE_DEDUCTION', name: '근태공제', amount: -amount })
      formulas.set('ATTENDANCE_DEDUCTION', `−통상시급 × ${formatHours(absenceMinutes)}시간`)
    }
  }

  const proration = input.incomeType === 'WAGE_MONTHLY' ? input.proration : undefined
  const items = input.paymentItems.map((item) =>
    item.prorate === true && proration !== undefined ? { ...item, amount: prorate(item.amount, proration) } : item,
  )

  const split = splitNonTaxable([...generated, ...items], rates)
  warnings.push(...split.warnings)
  const payments = split.lines.map((line) => {
    const formula = formulas.get(line.code)
    return formula === undefined ? line : { ...line, formula }
  })
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
    withholdTax: input.incomeTax.method !== 'NONE',
    otherDeductions: input.otherDeductions ?? [],
    extraBreakdown: [],
    warnings,
  })
}

/**
 * 일용근로소득 행을 계산합니다.
 *
 * 고용보험은 행 설정(보통 `RATE`)을 따릅니다. 국민연금·건강보험은 호출하는 쪽이 켤 때만 계산하고,
 * 8일·60시간 기준을 넘는데 꺼져 있으면 `DAILY_WORKER_SOCIAL_INSURANCE_REQUIRED` 경고를 붙입니다.
 */
export function calculateDailyWorkerRow(input: DailyWorkerRowInput, rates: PayrollRateTable): PayrollRowResult {
  const warnings: PayrollWarning[] = []
  const totalMinutes = (input.averageDailyMinutes ?? 0) * input.workDays
  if (
    dailyWorkerSocialInsuranceRequired(input.workDays, totalMinutes, rates) &&
    (input.insurance.nationalPension.mode === 'EXEMPT' || input.insurance.healthInsurance.mode === 'EXEMPT')
  ) {
    warnings.push({
      code: 'DAILY_WORKER_SOCIAL_INSURANCE_REQUIRED',
      message: `Daily workers with ${rates.dailyWorker.socialInsuranceMinDays}+ days or ${rates.dailyWorker.socialInsuranceMinHours}+ hours a month must join the national pension and health insurance.`,
    })
  }
  const payments: PaymentLine[] = [
    {
      code: 'DAILY_PAY',
      name: '일용근로소득',
      amount: input.payAmount,
      taxableAmount: input.payAmount,
      nonTaxableAmount: 0,
      formula: `${formatWon(input.payAmount)} (${input.workDays}일)`,
    },
  ]
  const insurance = calculateSocialInsurance({ ...input.insurance, insurablePay: input.payAmount }, rates)
  const tax = withholdDailyWorker(input.payAmount, input.workDays, input.dailyPays, rates)
  return finalizeWithholding(
    input.incomeType,
    input.attributionMonth,
    rates,
    payments,
    input.payAmount,
    insurance,
    tax,
    input.otherDeductions ?? [],
    warnings,
  )
}

/**
 * 사업소득 행을 계산합니다. 소득세 3%, 지방소득세 0.3%입니다.
 *
 * `AFTER_TAX`면 `payAmount`를 실지급액으로 보고 {@link grossUpFromNet}로 총액을 찾습니다. 예술인·노무제공자
 * 고용보험은 `insurableEarnings`(없으면 총액)에 예술인 요율로 공제합니다.
 */
export function calculateBusinessRow(input: BusinessRowInput, rates: PayrollRateTable): PayrollRowResult {
  const insuranceOf = (gross: number): SocialInsuranceResult =>
    calculateSocialInsurance(
      {
        ...EXEMPT_INSURANCE,
        employmentInsurance: {
          mode: input.employmentInsurance?.applicable === true ? 'RATE' : 'EXEMPT',
          kind: 'ARTIST',
        },
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
    input.taxDeductionMode === 'AFTER_TAX'
      ? grossUpFromNet(input.payAmount, netOf, Math.round(rates.businessIncome.ratePpm * 1.1))
      : input.payAmount
  const payments: PaymentLine[] = [
    {
      code: 'BUSINESS_PAY',
      name: '사업소득',
      amount: gross,
      taxableAmount: gross,
      nonTaxableAmount: 0,
      formula: grossFormula(input.taxDeductionMode, input.payAmount, gross),
    },
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
 * 기타소득 행을 계산합니다.
 *
 * 결과의 `taxablePay`는 기타소득금액(지급액 − 필요경비)이고, 필요경비는 `breakdown`에 있습니다.
 */
export function calculateOtherIncomeRow(input: OtherIncomeRowInput, rates: PayrollRateTable): PayrollRowResult {
  const netOf = (gross: number): number => {
    const tax = withholdOtherIncome(gross, input.necessaryExpense, input.taxRatePpm, rates)
    return gross - tax.incomeTax - tax.localIncomeTax
  }
  const expenseShare = input.necessaryExpense.kind === 'DEEMED' ? 1_000_000 - input.necessaryExpense.ratePpm : 1_000_000
  const effectivePpm = Math.round(((input.taxRatePpm ?? rates.otherIncome.ratePpm) * 1.1 * expenseShare) / 1_000_000)
  const gross =
    input.taxDeductionMode === 'AFTER_TAX' ? grossUpFromNet(input.payAmount, netOf, effectivePpm) : input.payAmount
  const tax = withholdOtherIncome(gross, input.necessaryExpense, input.taxRatePpm, rates)
  const expense = tax.trace.find((entry) => entry.code === 'NECESSARY_EXPENSE')?.amount ?? 0
  const payments: PaymentLine[] = [
    {
      code: 'OTHER_PAY',
      name: '기타소득',
      amount: gross,
      taxableAmount: gross,
      nonTaxableAmount: 0,
      formula: grossFormula(input.taxDeductionMode, input.payAmount, gross),
    },
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
  const isTax = (entry: TraceEntry): boolean => entry.code === 'INCOME_TAX' || entry.code === 'LOCAL_INCOME_TAX'
  return finalize({
    incomeType,
    attributionMonth,
    rates,
    payments,
    taxablePay,
    insurance,
    taxTrace: tax.trace.filter(isTax),
    incomeTax: tax.incomeTax,
    localIncomeTax: tax.localIncomeTax,
    withholdTax: true,
    otherDeductions,
    extraBreakdown: tax.trace.filter((entry) => !isTax(entry)),
    warnings,
  })
}

function finalize(input: FinalizeInput): PayrollRowResult {
  const grossPay = sum(input.payments.map((line) => line.amount))
  const nonTaxablePay = sum(input.payments.map((line) => line.nonTaxableAmount))
  const deductions: DeductionLine[] = input.insurance.trace.map((entry) => ({
    code: entry.code,
    name: entry.label,
    amount: entry.amount,
    formula: entry.formula,
  }))
  if (input.withholdTax) {
    for (const entry of input.taxTrace) {
      deductions.push({ code: entry.code, name: entry.label, amount: entry.amount, formula: entry.formula })
    }
  }
  for (const item of input.otherDeductions) {
    deductions.push({ code: item.code, name: item.name, amount: item.amount, formula: formatWon(item.amount) })
  }
  const deductionTotal = sum(deductions.map((line) => line.amount))
  const breakdown: TraceEntry[] = [
    ...input.payments.map((line) => ({
      code: line.code,
      label: line.name,
      amount: line.amount,
      formula: line.formula,
    })),
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

function grossFormula(mode: TaxDeductionMode | undefined, entered: number, gross: number): string {
  return mode === 'AFTER_TAX' ? `세후 ${formatWon(entered)} 역산 → ${formatWon(gross)}` : formatWon(gross)
}
