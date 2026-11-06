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
    { label: 'meal 250,000 → 200,000 non-taxable, 50,000 taxable', amount: 250_000, nonTaxable: 200_000 },
    { label: 'meal 200,000 → fully non-taxable', amount: 200_000, nonTaxable: 200_000 },
    {
      label: 'company limit 100,000 is smaller than the statutory 200,000',
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

  it('shares a category limit across items and tracks annual limits', () => {
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

  describe('childcare is limited per qualifying child', () => {
    const childcare = [
      { code: 'CHILDCARE', name: '보육수당', amount: 300_000, nonTaxableCategory: 'CHILDCARE' as const },
      { code: 'CHILDCARE_2', name: '가족수당(보육)', amount: 200_000, nonTaxableCategory: 'CHILDCARE' as const },
    ]

    it.each([
      { label: 'two children share 400,000 across items', children: 2, nonTaxable: [300_000, 100_000] },
      { label: 'three children cover 500,000', children: 3, nonTaxable: [300_000, 200_000] },
      { label: 'no child means no non-taxable childcare', children: 0, nonTaxable: [0, 0] },
    ])('$label', ({ children, nonTaxable }) => {
      const split = splitNonTaxable(childcare, rates, { childcareChildren: children })

      expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual(nonTaxable)
      expect(split.warnings.map((warning) => warning.code)).not.toContain('CHILDCARE_CHILDREN_UNKNOWN')
    })

    it('treats an unknown count as one child and warns', () => {
      const split = splitNonTaxable(childcare, rates)

      expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([200_000, 0])
      expect(split.warnings.map((warning) => warning.code)).toEqual([
        'CHILDCARE_CHILDREN_UNKNOWN',
        'NON_TAXABLE_LIMIT_EXCEEDED',
        'NON_TAXABLE_LIMIT_EXCEEDED',
      ])
    })

    it('does not warn about the child count without a childcare item', () => {
      const split = splitNonTaxable(
        [{ code: 'MEAL', name: '식대', amount: 200_000, nonTaxableCategory: 'MEAL' }],
        rates,
      )

      expect(split.warnings).toEqual([])
    })

    it('does not multiply other categories by the child count', () => {
      const split = splitNonTaxable(
        [{ code: 'MEAL', name: '식대', amount: 400_000, nonTaxableCategory: 'MEAL' }],
        rates,
        {
          childcareChildren: 2,
        },
      )

      expect(split.lines[0]).toMatchObject({ nonTaxableAmount: 200_000, taxableAmount: 200_000 })
    })

    it('treats a negative count as no child', () => {
      const split = splitNonTaxable(childcare, rates, { childcareChildren: -2 })

      expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([0, 0])
    })

    it('keeps a count set for another tax year but warns', () => {
      const split = splitNonTaxable(childcare, rates, { childcareChildren: 2, childcareChildrenStale: true })

      expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([300_000, 100_000])
      expect(split.warnings.map((warning) => warning.code)).toContain('CHILDCARE_CHILDREN_STALE')
    })

    it('does not multiply a table whose childcare limit is not per child', () => {
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

  it('caps each item by its own company limit within the category total', () => {
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

describe('working time', () => {
  it('derives weekly rest and monthly standard hours', () => {
    expect(weeklyRestMinutes(40 * 60)).toBe(8 * 60)
    expect(weeklyRestMinutes(20 * 60)).toBe(4 * 60)
    expect(weeklyRestMinutes(20 * 60, { method: 'PER_DAY', workDaysPerWeek: 4 })).toBe(5 * 60)
    expect(weeklyRestMinutes(14 * 60)).toBe(0)
    expect(monthlyStandardHours(40 * 60, 8 * 60)).toBe(209)
    expect(monthlyStandardHours(20 * 60, 4 * 60)).toBe(104)
  })

  it('pays premiums from the monthly ordinary wage without rounding the hourly rate', () => {
    expect(premiumPay({ amount: 2_090_000, perMinutes: 209 * 60 }, 600, 1_500_000)).toBe(150_000)
    expect(premiumPay({ amount: 3_000_000, perMinutes: 209 * 60 }, 90, 1_500_000)).toBe(32_296)
  })

  it('prorates by calendar days', () => {
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

  it('monthly 3,000,000 + meal 200,000, one dependant: 3,200,000 − 291,520 − 60,380 − 6,030 = 2,842,070', () => {
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

  it('taxes the meal allowance above 200,000', () => {
    const row = calculatePayrollRow(
      monthly({ paymentItems: [{ code: 'MEAL', name: '식대', amount: 250_000, nonTaxableCategory: 'MEAL' }] }),
      rates,
    )

    expect([row.taxablePay, row.nonTaxablePay]).toEqual([3_050_000, 200_000])
    expect(row.warnings.map((warning) => warning.code)).toContain('NON_TAXABLE_LIMIT_EXCEEDED')
  })

  it('passes the childcare child count to the non-taxable limit', () => {
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

  it('pays overtime on the ordinary wage and deducts absence hours', () => {
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

  it('prorates a mid-month joiner and warns below the minimum wage', () => {
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
      label: '5인 미만: 960,000 + 192,000 + 연장 10h × 1 = 120,000, 야간 가산 없음 = 1,272,000',
      multipliers: MULTIPLIERS_UNDER_FIVE,
      payments: { BASE_PAY: 960_000, WEEKLY_HOLIDAY_PAY: 192_000, OVERTIME_PAY: 120_000 },
      result: [1_272_000, 11_440, 4_020, 400, 1_272_000 - 11_440 - 4_020 - 400],
    },
  ])('hourly part-timer, $label', ({ multipliers, payments, result }) => {
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

  it('daily-paid wage rows pay days and weekly rest', () => {
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
      label: 'daily worker 200,000 × 5 days: (1,000,000 − 750,000) × 6% = 15,000 − 55% = 6,750',
      pay: 1_000_000,
      days: 5,
      result: [6_750, 670, 1_000_000 - 9_000 - 6_750 - 670],
    },
    {
      label: 'daily worker 180,000 × 1 day: 810 < 1,000 → 소액부징수',
      pay: 180_000,
      days: 1,
      result: [0, 0, 180_000 - 1_620],
    },
    {
      label: 'daily worker 150,000 × 3 days: nothing above the deduction',
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

  it('warns when a daily worker reaches the social insurance threshold while exempt', () => {
    const row = calculatePayrollRow(
      { incomeType: 'DAILY', attributionMonth: '2026-03', payAmount: 1_600_000, workDays: 8, insurance: EI_ONLY },
      rates,
    )

    expect(row.warnings.map((warning) => warning.code)).toEqual(['DAILY_WORKER_SOCIAL_INSURANCE_REQUIRED'])
  })

  it.each([
    {
      label: 'business 1,000,000: 3% = 30,000, net 967,000',
      input: { payAmount: 1_000_000 },
      result: [1_000_000, 30_000, 967_000],
    },
    {
      label: 'business after tax 967,000 grosses up to 1,000,000',
      input: { payAmount: 967_000, taxDeductionMode: 'AFTER_TAX' as const },
      result: [1_000_000, 30_000, 967_000],
    },
    { label: 'business 30,000: 900 < 1,000 → 소액부징수', input: { payAmount: 30_000 }, result: [30_000, 0, 30_000] },
  ])('$label', ({ input, result }) => {
    const row = calculatePayrollRow({ incomeType: 'BUSINESS', attributionMonth: '2026-03', ...input }, rates)

    expect([row.grossPay, row.incomeTax, row.netPay]).toEqual(result)
  })

  it('deducts artist employment insurance from business income: 1,000,000 × 0.8% = 8,000', () => {
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
      label: 'other 1,000,000 with 60% expenses: 80,000 + 8,000',
      pay: 1_000_000,
      ratePpm: 600_000,
      result: [80_000, 8_000, 912_000],
    },
    {
      label: 'other 125,000 with 60% expenses: income 50,000 ≤ 과세최저한',
      pay: 125_000,
      ratePpm: 600_000,
      result: [0, 0, 125_000],
    },
    {
      label: 'other 1,000,000 without expenses: 200,000 + 20,000',
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

  it('subtracts company deduction items from net pay', () => {
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
