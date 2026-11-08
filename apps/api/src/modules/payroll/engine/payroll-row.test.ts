import { describe, expect, it } from 'vitest'
import type { MonthlyWageRowInput, PayrollRowInput, PremiumMultipliers, SocialInsuranceInput } from './engine.types.ts'
import { splitNonTaxable } from './non-taxable.ts'
import { calculatePayrollRow } from './payroll-row.ts'
import { RATES_2026_01 } from './rate-tables-2026.ts'
import { EXACT_FORMULA } from './wage-income-tax.ts'
import {
  MULTIPLIERS_FIVE_OR_MORE,
  MULTIPLIERS_UNDER_FIVE,
  monthlyStandardHours,
  premiumPay,
  prorate,
  weeklyRestMinutes,
} from './working-time.ts'

const rates = RATES_2026_01
const RATE: Omit<SocialInsuranceInput, 'insurablePay'> = {
  nationalPension: { mode: 'RATE' },
  healthInsurance: { mode: 'RATE' },
  employmentInsurance: { mode: 'RATE' },
}
const EI_ONLY: Omit<SocialInsuranceInput, 'insurablePay'> = {
  nationalPension: { mode: 'EXEMPT' },
  healthInsurance: { mode: 'EXEMPT' },
  employmentInsurance: { mode: 'RATE' },
}
const ONE_DEPENDANT = {
  method: 'TAX_TABLE',
  dependants: 1,
  childrenAged8To20: 0,
  withholdingRatePpm: 1_000_000,
} as const

function amounts(row: { payments: { code: string; amount: number }[] }): Record<string, number> {
  return Object.fromEntries(row.payments.map((line) => [line.code, line.amount]))
}

describe('splitNonTaxable', () => {
  it.each([
    { label: '식대 250,000 → 비과세 200,000, 과세 50,000', amount: 250_000, nonTaxable: 200_000 },
    { label: '식대 200,000 → 전액 비과세', amount: 200_000, nonTaxable: 200_000 },
    {
      label: '회사 한도 100,000이 법정 한도 200,000보다 작음',
      amount: 150_000,
      company: 100_000,
      nonTaxable: 100_000,
    },
  ])('$label', ({ amount, company, nonTaxable }) => {
    const [line] = splitNonTaxable(
      [
        {
          code: 'MEAL',
          name: '식대',
          amount,
          nonTaxableCategory: 'MEAL',
          ...(company === undefined ? {} : { companyNonTaxableLimit: company }),
        },
      ],
      rates,
    ).lines

    expect(line).toMatchObject({ nonTaxableAmount: nonTaxable, taxableAmount: amount - nonTaxable })
  })

  it('같은 비과세 유형의 항목은 한도를 함께 쓰고 연 한도도 셉니다', () => {
    const split = splitNonTaxable(
      [
        { code: 'MEAL', name: '식대', amount: 150_000, nonTaxableCategory: 'MEAL' },
        { code: 'MEAL_2', name: '야근식대', amount: 100_000, nonTaxableCategory: 'MEAL' },
        {
          code: 'INVENTION',
          name: '직무발명보상금',
          amount: 3_000_000,
          nonTaxableCategory: 'INVENTION',
          annualNonTaxableUsed: 5_000_000,
        },
      ],
      rates,
    )

    expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([150_000, 50_000, 2_000_000])
    expect(split.warnings.map((warning) => warning.code)).toEqual([
      'NON_TAXABLE_LIMIT_EXCEEDED',
      'NON_TAXABLE_LIMIT_EXCEEDED',
    ])
  })

  describe('보육수당 비과세 한도는 대상 자녀 1명당입니다', () => {
    const childcare = [
      { code: 'CHILDCARE', name: '보육수당', amount: 300_000, nonTaxableCategory: 'CHILDCARE' as const },
      { code: 'CHILDCARE_2', name: '가족수당(보육)', amount: 200_000, nonTaxableCategory: 'CHILDCARE' as const },
    ]

    it.each([
      { label: '자녀 2명이면 항목들이 400,000을 함께 씀', children: 2, nonTaxable: [300_000, 100_000] },
      { label: '자녀 3명이면 500,000까지 비과세', children: 3, nonTaxable: [300_000, 200_000] },
      { label: '자녀가 없으면 보육수당 비과세 없음', children: 0, nonTaxable: [0, 0] },
    ])('$label', ({ children, nonTaxable }) => {
      const split = splitNonTaxable(childcare, rates, { childcareChildren: children })

      expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual(nonTaxable)
      expect(split.warnings.map((warning) => warning.code)).not.toContain('CHILDCARE_CHILDREN_UNKNOWN')
    })

    it('자녀 수를 모르면 1명으로 보고 경고합니다', () => {
      const split = splitNonTaxable(childcare, rates)

      expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([200_000, 0])
      expect(split.warnings.map((warning) => warning.code)).toEqual([
        'CHILDCARE_CHILDREN_UNKNOWN',
        'NON_TAXABLE_LIMIT_EXCEEDED',
        'NON_TAXABLE_LIMIT_EXCEEDED',
      ])
    })

    it('보육수당 항목이 없으면 자녀 수를 경고하지 않습니다', () => {
      const split = splitNonTaxable(
        [{ code: 'MEAL', name: '식대', amount: 200_000, nonTaxableCategory: 'MEAL' }],
        rates,
      )

      expect(split.warnings).toEqual([])
    })

    it('다른 비과세 유형에는 자녀 수를 곱하지 않습니다', () => {
      const split = splitNonTaxable(
        [{ code: 'MEAL', name: '식대', amount: 400_000, nonTaxableCategory: 'MEAL' }],
        rates,
        {
          childcareChildren: 2,
        },
      )

      expect(split.lines[0]).toMatchObject({ nonTaxableAmount: 200_000, taxableAmount: 200_000 })
    })

    it('자녀 수가 음수면 0명으로 봅니다', () => {
      const split = splitNonTaxable(childcare, rates, { childcareChildren: -2 })

      expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([0, 0])
    })

    it('다른 과세연도에 정한 자녀 수는 그대로 쓰되 경고합니다', () => {
      const split = splitNonTaxable(childcare, rates, { childcareChildren: 2, childcareChildrenStale: true })

      expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([300_000, 100_000])
      expect(split.warnings.map((warning) => warning.code)).toContain('CHILDCARE_CHILDREN_STALE')
    })

    it('보육수당 한도가 자녀 1명당이 아닌 기준표에는 자녀 수를 곱하지 않습니다', () => {
      const perEmployee = {
        ...rates,
        nonTaxable: { ...rates.nonTaxable, CHILDCARE: { monthlyLimit: 200_000, annualLimit: null } },
      }
      const split = splitNonTaxable(childcare, perEmployee, { childcareChildren: 2 })

      expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([200_000, 0])
      expect(split.warnings.map((warning) => warning.code)).toEqual([
        'NON_TAXABLE_LIMIT_EXCEEDED',
        'NON_TAXABLE_LIMIT_EXCEEDED',
      ])
    })
  })

  it('유형 합계 한도 안에서 항목마다 회사 한도로 막습니다', () => {
    const split = splitNonTaxable(
      [
        {
          code: 'CHILDCARE',
          name: '보육수당',
          amount: 300_000,
          nonTaxableCategory: 'CHILDCARE',
          companyNonTaxableLimit: 100_000,
        },
        { code: 'CHILDCARE_2', name: '가족수당(보육)', amount: 300_000, nonTaxableCategory: 'CHILDCARE' },
        { code: 'MEAL', name: '식대', amount: 150_000, nonTaxableCategory: 'MEAL' },
        {
          code: 'MEAL_2',
          name: '야근식대',
          amount: 100_000,
          nonTaxableCategory: 'MEAL',
          companyNonTaxableLimit: 30_000,
        },
      ],
      rates,
      { childcareChildren: 2 },
    )

    // 보육수당 합계 한도 400,000: 첫 항목은 회사 한도 100,000, 둘째는 남은 300,000. 식대 합계 200,000 중 둘째는 회사 한도 30,000.
    expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([100_000, 300_000, 150_000, 30_000])
  })
})

describe('근로시간', () => {
  it('주휴시간과 월 소정근로시간을 구합니다', () => {
    expect(weeklyRestMinutes(40 * 60)).toBe(8 * 60)
    expect(weeklyRestMinutes(20 * 60)).toBe(4 * 60)
    expect(weeklyRestMinutes(20 * 60, { method: 'PER_DAY', workDaysPerWeek: 4 })).toBe(5 * 60)
    expect(weeklyRestMinutes(14 * 60)).toBe(0)
    expect(monthlyStandardHours(40 * 60, 8 * 60)).toBe(209)
    expect(monthlyStandardHours(20 * 60, 4 * 60)).toBe(104)
  })

  it('가산수당은 통상시급을 반올림하지 않고 월 통상임금에서 계산합니다', () => {
    expect(premiumPay({ amount: 2_090_000, perMinutes: 209 * 60 }, 600, 1_500_000)).toBe(150_000)
    expect(premiumPay({ amount: 3_000_000, perMinutes: 209 * 60 }, 90, 1_500_000)).toBe(32_296)
  })

  it('역일수로 일할계산합니다', () => {
    expect(prorate(3_000_000, { method: 'CALENDAR_DAYS', payableDays: 10, totalDays: 30 })).toBe(1_000_000)
    expect(prorate(3_100_000, { method: 'CALENDAR_DAYS', payableDays: 15, totalDays: 31 })).toBe(1_500_000)
  })
})

describe('calculatePayrollRow', () => {
  const monthly = (overrides: Partial<MonthlyWageRowInput> = {}): PayrollRowInput => ({
    incomeType: 'WAGE_MONTHLY',
    attributionMonth: '2026-03',
    basePay: 3_000_000,
    paymentItems: [{ code: 'MEAL', name: '식대', amount: 200_000, nonTaxableCategory: 'MEAL' }],
    multipliers: MULTIPLIERS_FIVE_OR_MORE,
    monthlyStandardHours: 209,
    insurance: RATE,
    incomeTax: ONE_DEPENDANT,
    ...overrides,
  })

  it('월급 3,000,000 + 식대 200,000, 공제대상가족 1명: 3,200,000 − 291,520 − 60,380 − 6,030 = 2,842,070원입니다', () => {
    const row = calculatePayrollRow(monthly(), rates)

    expect(row).toMatchObject({
      grossPay: 3_200_000,
      taxablePay: 3_000_000,
      nonTaxablePay: 200_000,
      incomeTax: 60_380,
      localIncomeTax: 6_030,
      deductionTotal: 291_520 + 60_380 + 6_030,
      netPay: 2_842_070,
      employerInsuranceTotal: 142_500 + 107_850 + 14_170 + 34_500,
      rateTable: '2026-01',
    })
    expect(row.deductions.map((line) => line.code)).toEqual([
      'NATIONAL_PENSION',
      'HEALTH_INSURANCE',
      'LONG_TERM_CARE',
      'EMPLOYMENT_INSURANCE',
      'INCOME_TAX',
      'LOCAL_INCOME_TAX',
    ])
    expect(row.breakdown.find((entry) => entry.code === 'NATIONAL_PENSION')?.formula).toContain('4.75%')
  })

  it('식대가 200,000원을 넘으면 넘는 금액에 과세합니다', () => {
    const row = calculatePayrollRow(
      monthly({ paymentItems: [{ code: 'MEAL', name: '식대', amount: 250_000, nonTaxableCategory: 'MEAL' }] }),
      rates,
    )

    expect([row.taxablePay, row.nonTaxablePay]).toEqual([3_050_000, 200_000])
    expect(row.warnings.map((warning) => warning.code)).toContain('NON_TAXABLE_LIMIT_EXCEEDED')
  })

  it('보육수당 자녀 수를 비과세 한도에 넘깁니다', () => {
    const row = calculatePayrollRow(
      monthly({
        paymentItems: [{ code: 'CHILDCARE', name: '보육수당', amount: 400_000, nonTaxableCategory: 'CHILDCARE' }],
        childcareChildren: 2,
      }),
      rates,
    )

    expect([row.taxablePay, row.nonTaxablePay]).toEqual([3_000_000, 400_000])
    expect(row.warnings).toEqual([])
  })

  it('연장근로수당은 통상임금으로 주고 결근 시간은 뺍니다', () => {
    const row = calculatePayrollRow(
      monthly({
        basePay: 2_090_000,
        paymentItems: [{ code: 'POSITION', name: '직책수당', amount: 209_000, includeInOrdinaryWage: true }],
        work: { overtimeMinutes: 600, nightMinutes: 120, absenceMinutes: 240 },
      }),
      rates,
    )

    expect(amounts(row)).toEqual({
      BASE_PAY: 2_090_000,
      OVERTIME_PAY: 165_000,
      NIGHT_PAY: 11_000,
      ATTENDANCE_DEDUCTION: -44_000,
      POSITION: 209_000,
    })
  })

  it('월 중간 입사자는 일할계산하고 최저임금 미만이면 경고합니다', () => {
    const prorated = calculatePayrollRow(
      monthly({ proration: { method: 'CALENDAR_DAYS', payableDays: 16, totalDays: 31 } }),
      rates,
    )
    const low = calculatePayrollRow(monthly({ basePay: 2_000_000 }), rates)

    expect(prorated.payments[0]).toMatchObject({ code: 'BASE_PAY', amount: 1_548_387 })
    expect(low.warnings.map((warning) => warning.code)).toContain('BELOW_MINIMUM_WAGE')
  })

  const hourly = (multipliers: PremiumMultipliers): PayrollRowInput => ({
    incomeType: 'WAGE_HOURLY',
    attributionMonth: '2026-03',
    hourlyWage: 12_000,
    weeklyHolidayWeeks: 4,
    dailyRestMinutes: 240,
    work: { regularMinutes: 80 * 60, overtimeMinutes: 600, nightMinutes: 240 },
    paymentItems: [],
    multipliers,
    monthlyStandardHours: 104,
    insurance: EI_ONLY,
    incomeTax: ONE_DEPENDANT,
  })
  it.each([
    {
      label: '5인 이상: 960,000 + 주휴 192,000 + 연장 180,000 + 야간 24,000 = 1,356,000',
      multipliers: MULTIPLIERS_FIVE_OR_MORE,
      payments: { BASE_PAY: 960_000, WEEKLY_HOLIDAY_PAY: 192_000, OVERTIME_PAY: 180_000, NIGHT_PAY: 24_000 },
      result: [1_356_000, 12_200, 5_750, 570, 1_356_000 - 12_200 - 5_750 - 570],
    },
    {
      label: '5인 미만: 960,000 + 192,000 + 연장 10시간 × 1 = 120,000, 야간 가산 없음 = 1,272,000',
      multipliers: MULTIPLIERS_UNDER_FIVE,
      payments: { BASE_PAY: 960_000, WEEKLY_HOLIDAY_PAY: 192_000, OVERTIME_PAY: 120_000 },
      result: [1_272_000, 11_440, 4_020, 400, 1_272_000 - 11_440 - 4_020 - 400],
    },
  ])('시급제 단시간 근로자, $label', ({ multipliers, payments, result }) => {
    const row = calculatePayrollRow(hourly(multipliers), rates, { simpleTax: EXACT_FORMULA })

    expect(amounts(row)).toEqual(payments)
    expect([
      row.grossPay,
      row.insurance.employee.employmentInsurance,
      row.incomeTax,
      row.localIncomeTax,
      row.netPay,
    ]).toEqual(result)
  })

  it('일급제 근로소득 행은 근무일수와 주휴수당을 지급합니다', () => {
    const row = calculatePayrollRow(
      {
        incomeType: 'WAGE_DAILY',
        attributionMonth: '2026-03',
        dailyWage: 96_000,
        workedDays: 20,
        weeklyHolidayWeeks: 4,
        paymentItems: [],
        multipliers: MULTIPLIERS_FIVE_OR_MORE,
        monthlyStandardHours: 209,
        work: { overtimeMinutes: 120 },
        insurance: EI_ONLY,
        incomeTax: { ...ONE_DEPENDANT, method: 'NONE' },
      },
      rates,
    )

    expect(amounts(row)).toEqual({ BASE_PAY: 1_920_000, WEEKLY_HOLIDAY_PAY: 384_000, OVERTIME_PAY: 36_000 })
  })

  it.each([
    {
      label: '일용근로자 200,000 × 5일: (1,000,000 − 750,000) × 6% = 15,000 − 55% = 6,750',
      pay: 1_000_000,
      days: 5,
      result: [6_750, 670, 1_000_000 - 9_000 - 6_750 - 670],
    },
    {
      label: '일용근로자 180,000 × 1일: 810 < 1,000 → 소액부징수',
      pay: 180_000,
      days: 1,
      result: [0, 0, 180_000 - 1_620],
    },
    {
      label: '일용근로자 150,000 × 3일: 근로소득공제를 넘는 금액 없음',
      pay: 450_000,
      days: 3,
      result: [0, 0, 450_000 - 4_050],
    },
  ])('$label', ({ pay, days, result }) => {
    const row = calculatePayrollRow(
      { incomeType: 'DAILY', attributionMonth: '2026-03', payAmount: pay, workDays: days, insurance: EI_ONLY },
      rates,
    )

    expect([row.incomeTax, row.localIncomeTax, row.netPay]).toEqual(result)
  })

  it('미적용인 일용근로자가 4대보험 가입 기준에 이르면 경고합니다', () => {
    const row = calculatePayrollRow(
      { incomeType: 'DAILY', attributionMonth: '2026-03', payAmount: 1_600_000, workDays: 8, insurance: EI_ONLY },
      rates,
    )

    expect(row.warnings.map((warning) => warning.code)).toEqual(['DAILY_WORKER_SOCIAL_INSURANCE_REQUIRED'])
  })

  it.each([
    {
      label: '사업소득 1,000,000: 3% = 30,000, 실지급액 967,000',
      input: { payAmount: 1_000_000 },
      result: [1_000_000, 30_000, 967_000],
    },
    {
      label: '사업소득 세후 967,000은 세전 1,000,000으로 역산',
      input: { payAmount: 967_000, taxDeductionMode: 'AFTER_TAX' as const },
      result: [1_000_000, 30_000, 967_000],
    },
    { label: '사업소득 30,000: 900 < 1,000 → 소액부징수', input: { payAmount: 30_000 }, result: [30_000, 0, 30_000] },
  ])('$label', ({ input, result }) => {
    const row = calculatePayrollRow({ incomeType: 'BUSINESS', attributionMonth: '2026-03', ...input }, rates)

    expect([row.grossPay, row.incomeTax, row.netPay]).toEqual(result)
  })

  it('사업소득에서 예술인 고용보험료를 뺍니다: 1,000,000 × 0.8% = 8,000', () => {
    const row = calculatePayrollRow(
      {
        incomeType: 'BUSINESS',
        attributionMonth: '2026-03',
        payAmount: 1_000_000,
        employmentInsurance: { applicable: true },
      },
      rates,
    )

    expect([row.insurance.employee.employmentInsurance, row.netPay]).toEqual([8_000, 959_000])
  })

  it.each([
    {
      label: '기타소득 1,000,000, 필요경비 60%: 80,000 + 8,000',
      pay: 1_000_000,
      ratePpm: 600_000,
      result: [80_000, 8_000, 912_000],
    },
    {
      label: '기타소득 125,000, 필요경비 60%: 소득금액 50,000 ≤ 과세최저한',
      pay: 125_000,
      ratePpm: 600_000,
      result: [0, 0, 125_000],
    },
    {
      label: '기타소득 1,000,000, 필요경비 없음: 200,000 + 20,000',
      pay: 1_000_000,
      ratePpm: 0,
      result: [200_000, 20_000, 780_000],
    },
  ])('$label', ({ pay, ratePpm, result }) => {
    const row = calculatePayrollRow(
      {
        incomeType: 'OTHER',
        attributionMonth: '2026-03',
        payAmount: pay,
        necessaryExpense: { kind: 'DEEMED', ratePpm },
      },
      rates,
    )

    expect([row.incomeTax, row.localIncomeTax, row.netPay]).toEqual(result)
  })

  it('회사 공제 항목을 실지급액에서 뺍니다', () => {
    const row = calculatePayrollRow(
      {
        incomeType: 'BUSINESS',
        attributionMonth: '2026-03',
        payAmount: 1_000_000,
        otherDeductions: [{ code: 'ADVANCE', name: '선지급금', amount: 100_000 }],
      },
      rates,
    )

    expect(row.netPay).toBe(867_000)
  })
})
