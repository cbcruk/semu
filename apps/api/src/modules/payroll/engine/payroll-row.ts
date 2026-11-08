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

const 가산수당항목: readonly PremiumItem[] = [
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

const 보험료미적용: Omit<SocialInsuranceInput, 'insurablePay'> = {
  nationalPension: { mode: 'EXEMPT' },
  healthInsurance: { mode: 'EXEMPT' },
  employmentInsurance: { mode: 'EXEMPT' },
}

const 기본하루주휴분 = 8 * 60

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
  const 근무시간 = input.work ?? {}
  const 하루주휴분 = input.dailyRestMinutes ?? 기본하루주휴분
  const 계산된지급항목: PaymentItemInput[] = []
  const 계산식 = new Map<string, string>()
  const warnings: PayrollWarning[] = []
  let 통상임금단가: WageRate
  let 최저임금단가: WageRate

  const 통상임금항목합계 = sum(
    input.paymentItems.filter((item) => item.includeInOrdinaryWage === true).map((item) => item.amount),
  )
  const 최저임금산입항목합계 = sum(
    input.paymentItems.filter((item) => item.includeInMinimumWage === true).map((item) => item.amount),
  )

  if (input.incomeType === 'WAGE_MONTHLY') {
    통상임금단가 = monthlyWageRate(input.basePay + 통상임금항목합계, input.monthlyStandardHours)
    최저임금단가 = monthlyWageRate(input.basePay + 최저임금산입항목합계, input.monthlyStandardHours)
    const 기본급 = input.proration === undefined ? input.basePay : prorate(input.basePay, input.proration)
    계산된지급항목.push({ code: 'BASE_PAY', name: '기본급', amount: 기본급 })
    계산식.set(
      'BASE_PAY',
      input.proration === undefined
        ? formatWon(기본급)
        : `${formatWon(input.basePay)} × ${input.proration.payableDays} ÷ ${input.proration.totalDays} (일할계산)`,
    )
  } else if (input.incomeType === 'WAGE_HOURLY') {
    통상임금단가 = { amount: input.hourlyWage, perMinutes: 60 }
    최저임금단가 = 통상임금단가
    const 근로분 = 근무시간.regularMinutes ?? 0
    계산된지급항목.push({ code: 'BASE_PAY', name: '기본급', amount: payForMinutes(통상임금단가, 근로분) })
    계산식.set('BASE_PAY', `시급 ${formatWon(input.hourlyWage)} × ${formatHours(근로분)}시간`)
  } else {
    통상임금단가 = { amount: input.dailyWage, perMinutes: input.dailyContractualMinutes ?? 8 * 60 }
    최저임금단가 = 통상임금단가
    계산된지급항목.push({ code: 'BASE_PAY', name: '기본급', amount: input.dailyWage * input.workedDays })
    계산식.set('BASE_PAY', `일급 ${formatWon(input.dailyWage)} × ${input.workedDays}일`)
  }

  if (input.incomeType !== 'WAGE_MONTHLY' && (input.weeklyHolidayWeeks ?? 0) > 0) {
    const 개근주수 = input.weeklyHolidayWeeks ?? 0
    계산된지급항목.push({
      code: 'WEEKLY_HOLIDAY_PAY',
      name: '주휴수당',
      amount: weeklyHolidayAllowance(통상임금단가, 하루주휴분, 개근주수),
    })
    계산식.set('WEEKLY_HOLIDAY_PAY', `통상시급 × 주휴 ${formatHours(하루주휴분)}시간 × ${개근주수}주`)
  }

  for (const premium of 가산수당항목) {
    const 근로분 = 근무시간[premium.minutes] ?? 0
    const 지급배수ppm = input.multipliers[premium.multiplier]
    const 가산수당 = premiumPay(통상임금단가, 근로분, 지급배수ppm)
    if (가산수당 === 0) continue
    계산된지급항목.push({ code: premium.code, name: premium.name, amount: 가산수당 })
    계산식.set(premium.code, `통상시급 × ${formatHours(근로분)}시간 × ${formatPpm(지급배수ppm)}`)
  }

  if (input.incomeType === 'WAGE_MONTHLY') {
    const 근태공제분 = (근무시간.absenceMinutes ?? 0) + (근무시간.weeklyHolidayDeductionDays ?? 0) * 하루주휴분
    const 근태공제 = payForMinutes(통상임금단가, 근태공제분)
    if (근태공제 > 0) {
      계산된지급항목.push({ code: 'ATTENDANCE_DEDUCTION', name: '근태공제', amount: -근태공제 })
      계산식.set('ATTENDANCE_DEDUCTION', `−통상시급 × ${formatHours(근태공제분)}시간`)
    }
  }

  const 일할계산 = input.incomeType === 'WAGE_MONTHLY' ? input.proration : undefined
  const 지급항목 = input.paymentItems.map((item) =>
    item.prorate === true && 일할계산 !== undefined ? { ...item, amount: prorate(item.amount, 일할계산) } : item,
  )

  const 비과세분리 = splitNonTaxable([...계산된지급항목, ...지급항목], rates, {
    ...(input.childcareChildren === undefined ? {} : { childcareChildren: input.childcareChildren }),
    childcareChildrenStale:
      input.childcareChildrenEffectiveFrom !== undefined &&
      input.childcareChildrenEffectiveFrom.slice(0, 4) !== input.attributionMonth.slice(0, 4),
  })
  warnings.push(...비과세분리.warnings)
  const payments = 비과세분리.lines.map((line) => {
    const formula = 계산식.get(line.code)
    return formula === undefined ? line : { ...line, formula }
  })
  const 과세급여 = Math.max(0, sum(payments.map((line) => line.taxableAmount)))

  if (isBelowMinimumWage(최저임금단가, rates)) {
    warnings.push({
      code: 'BELOW_MINIMUM_WAGE',
      message: `The hourly equivalent is below the ${rates.effectiveFrom.slice(0, 4)} minimum wage of ${formatWon(rates.minimumWage.hourly)} won.`,
    })
  }

  // 4대보험료 계산 결과(금액이 아닌 결과 객체). 식별자는 숫자로 시작할 수 없어 사회보험료로 씁니다
  const 사회보험료 = calculateSocialInsurance({ ...input.insurance, insurablePay: 과세급여 }, rates)
  const 근로소득세계산 = calculateWageIncomeTax(과세급여, input.incomeTax, rates, options.simpleTax ?? MIDPOINT_FORMULA)
  return 결과조립({
    incomeType: input.incomeType,
    attributionMonth: input.attributionMonth,
    rates,
    payments,
    taxablePay: 과세급여,
    insurance: 사회보험료,
    taxTrace: 근로소득세계산.trace,
    incomeTax: 근로소득세계산.incomeTax,
    localIncomeTax: 근로소득세계산.localIncomeTax,
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
  const 총근로분 = (input.averageDailyMinutes ?? 0) * input.workDays
  if (
    dailyWorkerSocialInsuranceRequired(input.workDays, 총근로분, rates) &&
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
  const 사회보험료 = calculateSocialInsurance({ ...input.insurance, insurablePay: input.payAmount }, rates)
  const 원천징수 = withholdDailyWorker(input.payAmount, input.workDays, input.dailyPays, rates)
  return 원천징수결과조립(
    input.incomeType,
    input.attributionMonth,
    rates,
    payments,
    input.payAmount,
    사회보험료,
    원천징수,
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
  const 보험료계산 = (총액: number): SocialInsuranceResult =>
    calculateSocialInsurance(
      {
        ...보험료미적용,
        employmentInsurance: {
          mode: input.employmentInsurance?.applicable === true ? 'RATE' : 'EXEMPT',
          kind: 'ARTIST',
        },
        insurablePay: input.employmentInsurance?.insurableEarnings ?? 총액,
        industrialAccidentRatePpm: 0,
      },
      rates,
    )
  const 실지급액계산 = (총액: number): number => {
    const 원천징수 = withholdBusinessIncome(총액, rates)
    return 총액 - 원천징수.incomeTax - 원천징수.localIncomeTax - 보험료계산(총액).employee.total
  }
  const 지급총액 =
    input.taxDeductionMode === 'AFTER_TAX'
      ? grossUpFromNet(input.payAmount, 실지급액계산, Math.round(rates.businessIncome.ratePpm * 1.1))
      : input.payAmount
  const payments: PaymentLine[] = [
    {
      code: 'BUSINESS_PAY',
      name: '사업소득',
      amount: 지급총액,
      taxableAmount: 지급총액,
      nonTaxableAmount: 0,
      formula: 지급총액계산식(input.taxDeductionMode, input.payAmount, 지급총액),
    },
  ]
  return 원천징수결과조립(
    input.incomeType,
    input.attributionMonth,
    rates,
    payments,
    지급총액,
    보험료계산(지급총액),
    withholdBusinessIncome(지급총액, rates),
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
  const 실지급액계산 = (총액: number): number => {
    const 원천징수 = withholdOtherIncome(총액, input.necessaryExpense, input.taxRatePpm, rates)
    return 총액 - 원천징수.incomeTax - 원천징수.localIncomeTax
  }
  const 경비제외비율ppm =
    input.necessaryExpense.kind === 'DEEMED' ? 1_000_000 - input.necessaryExpense.ratePpm : 1_000_000
  const 실효세율ppm = Math.round(((input.taxRatePpm ?? rates.otherIncome.ratePpm) * 1.1 * 경비제외비율ppm) / 1_000_000)
  const 지급총액 =
    input.taxDeductionMode === 'AFTER_TAX'
      ? grossUpFromNet(input.payAmount, 실지급액계산, 실효세율ppm)
      : input.payAmount
  const 원천징수 = withholdOtherIncome(지급총액, input.necessaryExpense, input.taxRatePpm, rates)
  const 필요경비 = 원천징수.trace.find((entry) => entry.code === 'NECESSARY_EXPENSE')?.amount ?? 0
  const payments: PaymentLine[] = [
    {
      code: 'OTHER_PAY',
      name: '기타소득',
      amount: 지급총액,
      taxableAmount: 지급총액,
      nonTaxableAmount: 0,
      formula: 지급총액계산식(input.taxDeductionMode, input.payAmount, 지급총액),
    },
  ]
  return 원천징수결과조립(
    input.incomeType,
    input.attributionMonth,
    rates,
    payments,
    지급총액 - 필요경비,
    calculateSocialInsurance({ ...보험료미적용, insurablePay: 0, industrialAccidentRatePpm: 0 }, rates),
    원천징수,
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

/** 원천징수 결과(일용·사업·기타소득)를 행 결과로 묶습니다. */
function 원천징수결과조립(
  incomeType: PayrollIncomeType,
  attributionMonth: YearMonth,
  rates: PayrollRateTable,
  payments: PaymentLine[],
  taxablePay: number,
  insurance: SocialInsuranceResult,
  원천징수: WithholdingResult,
  otherDeductions: readonly OtherDeductionInput[],
  warnings: PayrollWarning[],
): PayrollRowResult {
  const 세금항목인가 = (entry: TraceEntry): boolean => entry.code === 'INCOME_TAX' || entry.code === 'LOCAL_INCOME_TAX'
  return 결과조립({
    incomeType,
    attributionMonth,
    rates,
    payments,
    taxablePay,
    insurance,
    taxTrace: 원천징수.trace.filter(세금항목인가),
    incomeTax: 원천징수.incomeTax,
    localIncomeTax: 원천징수.localIncomeTax,
    withholdTax: true,
    otherDeductions,
    extraBreakdown: 원천징수.trace.filter((entry) => !세금항목인가(entry)),
    warnings,
  })
}

/** 지급·공제 항목을 모아 행 결과를 만듭니다. */
function 결과조립(input: FinalizeInput): PayrollRowResult {
  const 지급총액 = sum(input.payments.map((line) => line.amount))
  const 비과세급여 = sum(input.payments.map((line) => line.nonTaxableAmount))
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
  const 공제총액 = sum(deductions.map((line) => line.amount))
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
  const 차인지급액 = 지급총액 - 공제총액
  return {
    incomeType: input.incomeType,
    attributionMonth: input.attributionMonth,
    rateTable: input.rates.effectiveFrom,
    payments: input.payments,
    grossPay: 지급총액,
    taxablePay: input.taxablePay,
    nonTaxablePay: 비과세급여,
    insurance: input.insurance,
    incomeTax: input.withholdTax ? input.incomeTax : 0,
    localIncomeTax: input.withholdTax ? input.localIncomeTax : 0,
    deductions,
    deductionTotal: 공제총액,
    netPay: 차인지급액,
    employerInsuranceTotal: input.insurance.employer.total,
    breakdown,
    warnings: input.warnings,
  }
}

function 지급총액계산식(mode: TaxDeductionMode | undefined, 입력금액: number, 지급총액: number): string {
  return mode === 'AFTER_TAX' ? `세후 ${formatWon(입력금액)} 역산 → ${formatWon(지급총액)}` : formatWon(지급총액)
}
