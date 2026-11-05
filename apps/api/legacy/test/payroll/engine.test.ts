import { describe, expect, it } from 'vitest'
import { toPlainDate } from '../../src/lib/plain-date'
import {
  annualSimpleTaxSteps,
  calculatePayrollRow,
  calculateSeverancePay,
  calculateSocialInsurance,
  calculateWageIncomeTax,
  EXACT_FORMULA,
  generateSimpleTaxTable,
  lookupSimpleTaxTable,
  MIDPOINT_FORMULA,
  monthlyStandardHours,
  MULTIPLIERS_FIVE_OR_MORE,
  MULTIPLIERS_UNDER_FIVE,
  PAYROLL_RATE_TABLES,
  premiumPay,
  prorate,
  RATES_2026_01,
  resolveRateTable,
  splitNonTaxable,
  unverifiedRatePaths,
  weeklyRestHours,
  type PayrollRowInput,
  type SocialInsuranceInput,
} from '../../src/modules/payroll/engine'

const rates = RATES_2026_01
const RATE: Omit<SocialInsuranceInput, 'insurablePay'> = {
  nationalPension: { mode: 'rate' },
  healthInsurance: { mode: 'rate' },
  employmentInsurance: { mode: 'rate' },
}
const EI_ONLY: Omit<SocialInsuranceInput, 'insurablePay'> = {
  nationalPension: { mode: 'exempt' },
  healthInsurance: { mode: 'exempt' },
  employmentInsurance: { mode: 'rate' },
}
const ONE_DEPENDANT = { method: 'tax_table_based', dependants: 1, childrenAged8To20: 0, withholdingRatio: 100 } as const

describe('rate tables', () => {
  it('resolves the table in force by month', () => {
    expect(resolveRateTable(PAYROLL_RATE_TABLES, '2026-01').effectiveFrom).toBe('2026-01')
    expect(resolveRateTable(PAYROLL_RATE_TABLES, '2026-06').effectiveFrom).toBe('2026-01')
    expect(resolveRateTable(PAYROLL_RATE_TABLES, '2026-07').effectiveFrom).toBe('2026-07')
    expect(() => resolveRateTable(PAYROLL_RATE_TABLES, '2025-12')).toThrow(RangeError)
  })

  it('records provenance for every top-level rate group and flags the spec-confirmed values as verified', () => {
    const paths = Object.keys(rates.verification)
    for (const group of ['minimumWage', 'nationalPension', 'healthInsurance', 'longTermCare', 'employmentInsurance', 'wageIncomeTax', 'dailyWorker', 'nonTaxable']) {
      expect(paths.some((path) => path.startsWith(`${group}.`))).toBe(true)
    }
    const unverified = unverifiedRatePaths(rates)
    expect(unverified).toContain('longTermCare.ratioOfHealthPpm')
    expect(unverified).toContain('nationalPension.baseMax')
    expect(unverified).not.toContain('nationalPension.employeeRatePpm')
    expect(unverified).not.toContain('minimumWage.hourly')
    expect(rates.nationalPension.employeeRatePpm).toBe(47_500)
    expect(rates.healthInsurance.employeeRatePpm).toBe(35_950)
    expect(rates.employmentInsurance.employeeRatePpm).toBe(9_000)
    expect(rates.minimumWage.hourly).toBe(10_320)
  })
})

describe('social insurance', () => {
  const cases: { label: string; pay: number; base?: number; expected: { nps: number; nhis: number; ltc: number; ei: number } }[] = [
    {
      label: '3,000,000: NPS 3,000,000×4.75%=142,500; NHIS ×3.595%=107,850; LTC 107,850×13.14%=14,171.49→14,170; EI ×0.9%=27,000',
      pay: 3_000_000,
      expected: { nps: 142_500, nhis: 107_850, ltc: 14_170, ei: 27_000 },
    },
    {
      label: 'NPS cap: 8,000,000 → base 6,370,000×4.75%=302,575→302,570; NHIS 287,600; LTC 37,790.64→37,790; EI 72,000',
      pay: 8_000_000,
      expected: { nps: 302_570, nhis: 287_600, ltc: 37_790, ei: 72_000 },
    },
    {
      label: 'NPS floor: 300,000 → base 400,000×4.75%=19,000; NHIS 10,785→10,780; LTC 1,416.49→1,410; EI 2,700',
      pay: 300_000,
      expected: { nps: 19_000, nhis: 10_780, ltc: 1_410, ei: 2_700 },
    },
    {
      label: 'NPS base truncated below 1,000: 3,456,789 → 3,456,000×4.75%=164,160; NHIS 124,271.6→124,270; LTC 16,329.07→16,320; EI 31,111.1→31,110',
      pay: 3_456_789,
      expected: { nps: 164_160, nhis: 124_270, ltc: 16_320, ei: 31_110 },
    },
  ]
  it.each(cases)('$label', ({ pay, expected }) => {
    const { employee } = calculateSocialInsurance({ ...RATE, insurablePay: pay }, rates)
    expect([employee.nationalPension, employee.healthInsurance, employee.longTermCare, employee.employmentInsurance]).toEqual([
      expected.nps,
      expected.nhis,
      expected.ltc,
      expected.ei,
    ])
  })

  it('adds the employer stability rate and the industrial accident rate on the employer side only', () => {
    const { employee, employer } = calculateSocialInsurance({ ...RATE, insurablePay: 3_000_000, industrialAccidentRatePpm: 7_000 }, rates)
    expect(employer.employmentInsurance).toBe(34_500)
    expect(employer.industrialAccident).toBe(21_000)
    expect(employee.industrialAccident).toBe(0)
    expect(employer.total).toBe(142_500 + 107_850 + 14_170 + 34_500 + 21_000)
  })

  it('takes noticed amounts as is and skips exempt insurances', () => {
    const result = calculateSocialInsurance(
      {
        insurablePay: 3_000_000,
        nationalPension: { mode: 'notice', noticeAmount: 135_000 },
        healthInsurance: { mode: 'notice', noticeAmount: 100_000, longTermCareNoticeAmount: 13_000 },
        employmentInsurance: { mode: 'exempt' },
      },
      rates,
    )
    expect(result.employee).toMatchObject({ nationalPension: 135_000, healthInsurance: 100_000, longTermCare: 13_000, employmentInsurance: 0, total: 248_000 })
    expect(result.employer.nationalPension).toBe(135_000)
  })
})

describe('wage income tax (간이세액)', () => {
  it('follows the annual formula step by step for 3,000,000 won and one dependant', () => {
    expect(annualSimpleTaxSteps(3_000_000, 1, rates)).toEqual({
      annualPay: 36_000_000,
      earnedIncomeDeduction: 10_650_000,
      earnedIncome: 25_350_000,
      personalDeduction: 1_500_000,
      pensionDeduction: 1_710_000,
      specialDeduction: 4_240_000,
      taxBase: 17_900_000,
      calculatedTax: 1_425_000,
      earnedIncomeCredit: 716_000,
      annualTax: 709_000,
    })
  })

  const cases: { label: string; pay: number; dependants: number; children: number; ratio: 80 | 100 | 120; strategy: typeof EXACT_FORMULA; tax: number; local: number }[] = [
    { label: 'exact 3,000,000: 709,000 ÷ 12 = 59,083 → 59,080; local 5,908 → 5,900', pay: 3_000_000, dependants: 1, children: 0, ratio: 100, strategy: EXACT_FORMULA, tax: 59_080, local: 5_900 },
    {
      label: 'midpoint 3,000,000 (row 3,000,000–3,020,000 → 3,010,000): 724,585 ÷ 12 = 60,382 → 60,380',
      pay: 3_000_000,
      dependants: 1,
      children: 0,
      ratio: 100,
      strategy: MIDPOINT_FORMULA,
      tax: 60_380,
      local: 6_030,
    },
    { label: 'exact 3,000,000 at 80%: 59,080 × 80% = 47,264 → 47,260', pay: 3_000_000, dependants: 1, children: 0, ratio: 80, strategy: EXACT_FORMULA, tax: 47_260, local: 4_720 },
    { label: 'exact 3,000,000 at 120%: 59,080 × 120% = 70,896 → 70,890', pay: 3_000_000, dependants: 1, children: 0, ratio: 120, strategy: EXACT_FORMULA, tax: 70_890, local: 7_080 },
    {
      label: 'exact 3,000,000, two dependants, one child aged 8–20: 506,250 ÷ 12 = 42,187 → 42,180 − 12,500 = 29,680',
      pay: 3_000_000,
      dependants: 2,
      children: 1,
      ratio: 100,
      strategy: EXACT_FORMULA,
      tax: 29_680,
      local: 2_960,
    },
    { label: 'below the first table row (770,000) nothing is withheld', pay: 700_000, dependants: 1, children: 0, ratio: 100, strategy: MIDPOINT_FORMULA, tax: 0, local: 0 },
  ]
  it.each(cases)('$label', ({ pay, dependants, children, ratio, strategy, tax, local }) => {
    const result = calculateWageIncomeTax(pay, { method: 'tax_table_based', dependants, childrenAged8To20: children, withholdingRatio: ratio }, rates, strategy)
    expect([result.incomeTax, result.localIncomeTax]).toEqual([tax, local])
  })

  it('adds the over-10,000,000 formula on top of the tax at 10,000,000', () => {
    const atThreshold = EXACT_FORMULA.monthlyTax({ monthlyTaxablePay: 10_000_000, dependants: 1, childrenAged8To20: 0 }, rates)
    const above = EXACT_FORMULA.monthlyTax({ monthlyTaxablePay: 12_000_000, dependants: 1, childrenAged8To20: 0 }, rates)
    expect(above - atThreshold).toBe(25_000 + 2_000_000 * 0.343)
  })

  it('honours manual input and none', () => {
    const manual = calculateWageIncomeTax(3_000_000, { ...ONE_DEPENDANT, method: 'manual_input', manualAmount: 50_000 }, rates, EXACT_FORMULA)
    expect([manual.incomeTax, manual.localIncomeTax]).toEqual([50_000, 5_000])
    expect(calculateWageIncomeTax(3_000_000, { ...ONE_DEPENDANT, method: 'none' }, rates, EXACT_FORMULA).incomeTax).toBe(0)
  })

  it('applies the 중소기업 감면 before the withholding ratio, capped by the remaining limit', () => {
    const reduced = calculateWageIncomeTax(3_000_000, { ...ONE_DEPENDANT, reduction: { ratePpm: 900_000, remainingAnnualLimit: 10_000 } }, rates, EXACT_FORMULA)
    expect(reduced.incomeTax).toBe(49_080)
  })

  it('lets an official table replace the formula', () => {
    const strategy = lookupSimpleTaxTable([{ min: 3_000_000, max: 3_020_000, taxes: [74_350, 56_850] }], MIDPOINT_FORMULA)
    expect(strategy.monthlyTax({ monthlyTaxablePay: 3_010_000, dependants: 1, childrenAged8To20: 0 }, rates)).toBe(74_350)
    expect(strategy.monthlyTax({ monthlyTaxablePay: 3_010_000, dependants: 2, childrenAged8To20: 1 }, rates)).toBe(56_850 - 12_500)
    expect(strategy.monthlyTax({ monthlyTaxablePay: 2_000_000, dependants: 1, childrenAged8To20: 0 }, rates)).toBe(0)
    expect(strategy.monthlyTax({ monthlyTaxablePay: 5_000_000, dependants: 1, childrenAged8To20: 0 }, rates)).toBe(
      MIDPOINT_FORMULA.monthlyTax({ monthlyTaxablePay: 5_000_000, dependants: 1, childrenAged8To20: 0 }, rates),
    )
  })

  it('generates the table rows with the official band widths and non-increasing tax by dependants', () => {
    const rows = generateSimpleTaxTable(rates)
    expect(rows).toHaveLength(146 + 150 + 350)
    const row = rows.find((candidate) => candidate.min === 3_000_000)
    expect(row?.max).toBe(3_020_000)
    expect(row?.taxes[0]).toBe(60_380)
    for (const candidate of rows) for (let index = 1; index < candidate.taxes.length; index += 1) expect(candidate.taxes[index]).toBeLessThanOrEqual(candidate.taxes[index - 1] ?? 0)
  })
})

describe('non-taxable limits', () => {
  it.each([
    { label: 'meal 250,000 → 200,000 non-taxable, 50,000 taxable', amount: 250_000, company: undefined, nonTaxable: 200_000 },
    { label: 'meal 200,000 → fully non-taxable', amount: 200_000, company: undefined, nonTaxable: 200_000 },
    { label: 'company limit 100,000 is smaller than the statutory 200,000', amount: 150_000, company: 100_000, nonTaxable: 100_000 },
  ])('$label', ({ amount, company, nonTaxable }) => {
    const [line] = splitNonTaxable(
      [{ code: 'meal', name: '식대', amount, nonTaxableCategory: 'meal', ...(company === undefined ? {} : { companyNonTaxableLimit: company }) }],
      rates,
    ).lines
    expect(line).toMatchObject({ nonTaxableAmount: nonTaxable, taxableAmount: amount - nonTaxable })
  })

  it('shares a category limit across items and tracks annual limits', () => {
    const split = splitNonTaxable(
      [
        { code: 'meal', name: '식대', amount: 150_000, nonTaxableCategory: 'meal' },
        { code: 'meal2', name: '야근식대', amount: 100_000, nonTaxableCategory: 'meal' },
        { code: 'invention', name: '직무발명보상금', amount: 3_000_000, nonTaxableCategory: 'invention', annualNonTaxableUsed: 5_000_000 },
      ],
      rates,
    )
    expect(split.lines.map((line) => line.nonTaxableAmount)).toEqual([150_000, 50_000, 2_000_000])
    expect(split.warnings.map((warning) => warning.code)).toEqual(['NON_TAXABLE_LIMIT_EXCEEDED', 'NON_TAXABLE_LIMIT_EXCEEDED'])
  })
})

describe('working time', () => {
  it('derives weekly rest and monthly standard hours', () => {
    expect(weeklyRestHours(40)).toBe(8)
    expect(weeklyRestHours(20)).toBe(4)
    expect(weeklyRestHours(20, { method: 'per_day', workDaysPerWeek: 4 })).toBe(5)
    expect(weeklyRestHours(14)).toBe(0)
    expect(monthlyStandardHours(40, 8)).toBe(209)
    expect(monthlyStandardHours(20, 4)).toBe(104)
  })

  it('pays premiums from the monthly ordinary wage without rounding the hourly rate', () => {
    expect(premiumPay({ amount: 2_090_000, perMinutes: 209 * 60 }, 10, 1.5)).toBe(150_000)
    expect(premiumPay({ amount: 3_000_000, perMinutes: 209 * 60 }, 1.5, 1.5)).toBe(32_296)
  })

  it('prorates by calendar days', () => {
    expect(prorate(3_000_000, { method: 'calendar_days', payableDays: 10, totalDays: 30 })).toBe(1_000_000)
    expect(prorate(3_100_000, { method: 'calendar_days', payableDays: 15, totalDays: 31 })).toBe(1_500_000)
  })
})

describe('calculatePayrollRow', () => {
  const monthly = (overrides: Partial<Extract<PayrollRowInput, { incomeType: 'wage_monthly' }>> = {}): PayrollRowInput => ({
    incomeType: 'wage_monthly',
    attributionMonth: '2026-03',
    basePay: 3_000_000,
    paymentItems: [{ code: 'meal', name: '식대', amount: 200_000, nonTaxableCategory: 'meal' }],
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
      'national_pension',
      'health_insurance',
      'long_term_care',
      'employment_insurance',
      'income_tax',
      'local_income_tax',
    ])
    expect(row.breakdown.find((entry) => entry.code === 'national_pension')?.formula).toContain('4.75%')
  })

  it('taxes the meal allowance above 200,000', () => {
    const row = calculatePayrollRow(monthly({ paymentItems: [{ code: 'meal', name: '식대', amount: 250_000, nonTaxableCategory: 'meal' }] }), rates)
    expect([row.taxablePay, row.nonTaxablePay]).toEqual([3_050_000, 200_000])
    expect(row.warnings.map((warning) => warning.code)).toContain('NON_TAXABLE_LIMIT_EXCEEDED')
  })

  it('pays overtime on the ordinary wage and deducts absence hours', () => {
    const row = calculatePayrollRow(
      monthly({
        basePay: 2_090_000,
        paymentItems: [{ code: 'position', name: '직책수당', amount: 209_000, includeInOrdinaryWage: true }],
        work: { overtimeHours: 10, nightHours: 2, absenceHours: 4 },
      }),
      rates,
    )
    expect(Object.fromEntries(row.payments.map((line) => [line.code, line.amount]))).toEqual({
      base_pay: 2_090_000,
      overtime_pay: 165_000,
      night_pay: 11_000,
      attendance_deduction: -44_000,
      position: 209_000,
    })
  })

  it('prorates a mid-month joiner and warns below the minimum wage', () => {
    const prorated = calculatePayrollRow(monthly({ proration: { method: 'calendar_days', payableDays: 16, totalDays: 31 } }), rates)
    expect(prorated.payments[0]).toMatchObject({ code: 'base_pay', amount: 1_548_387 })
    const low = calculatePayrollRow(monthly({ basePay: 2_000_000 }), rates)
    expect(low.warnings.map((warning) => warning.code)).toContain('BELOW_MINIMUM_WAGE')
  })

  const hourly = (multipliers: typeof MULTIPLIERS_FIVE_OR_MORE): PayrollRowInput => ({
    incomeType: 'wage_hourly',
    attributionMonth: '2026-03',
    hourlyWage: 12_000,
    weeklyHolidayWeeks: 4,
    dailyRestHours: 4,
    work: { regularHours: 80, overtimeHours: 10, nightHours: 4 },
    paymentItems: [],
    multipliers,
    monthlyStandardHours: 104,
    insurance: EI_ONLY,
    incomeTax: ONE_DEPENDANT,
  })
  it.each([
    {
      label: '5인 이상: 960,000 + 주휴 4h×4주×12,000=192,000 + 연장 10h×1.5=180,000 + 야간 4h×0.5=24,000 = 1,356,000',
      multipliers: MULTIPLIERS_FIVE_OR_MORE,
      payments: { base_pay: 960_000, weekly_holiday_pay: 192_000, overtime_pay: 180_000, night_pay: 24_000 },
      gross: 1_356_000,
      ei: 12_200,
      tax: 5_750,
      local: 570,
      net: 1_356_000 - 12_200 - 5_750 - 570,
    },
    {
      label: '5인 미만: 960,000 + 192,000 + 연장 10h×1=120,000, 야간 가산 없음 = 1,272,000',
      multipliers: MULTIPLIERS_UNDER_FIVE,
      payments: { base_pay: 960_000, weekly_holiday_pay: 192_000, overtime_pay: 120_000 },
      gross: 1_272_000,
      ei: 11_440,
      tax: 4_020,
      local: 400,
      net: 1_272_000 - 11_440 - 4_020 - 400,
    },
  ])('hourly part-timer, $label', ({ multipliers, payments, gross, ei, tax, local, net }) => {
    const row = calculatePayrollRow(hourly(multipliers), rates, { simpleTax: EXACT_FORMULA })
    expect(Object.fromEntries(row.payments.map((line) => [line.code, line.amount]))).toEqual(payments)
    expect([row.grossPay, row.insurance.employee.employmentInsurance, row.incomeTax, row.localIncomeTax, row.netPay]).toEqual([gross, ei, tax, local, net])
  })

  it('daily-paid wage rows pay days and weekly rest', () => {
    const row = calculatePayrollRow(
      {
        incomeType: 'wage_daily',
        attributionMonth: '2026-03',
        dailyWage: 96_000,
        workedDays: 20,
        weeklyHolidayWeeks: 4,
        paymentItems: [],
        multipliers: MULTIPLIERS_FIVE_OR_MORE,
        monthlyStandardHours: 209,
        work: { overtimeHours: 2 },
        insurance: EI_ONLY,
        incomeTax: { ...ONE_DEPENDANT, method: 'none' },
      },
      rates,
    )
    expect(Object.fromEntries(row.payments.map((line) => [line.code, line.amount]))).toEqual({
      base_pay: 1_920_000,
      weekly_holiday_pay: 384_000,
      overtime_pay: 36_000,
    })
  })

  it.each([
    {
      label: 'daily worker 200,000 × 5 days: (1,000,000 − 750,000) × 6% = 15,000 − 55% = 6,750; local 675 → 670; EI 9,000',
      pay: 1_000_000,
      days: 5,
      tax: 6_750,
      local: 670,
      net: 1_000_000 - 9_000 - 6_750 - 670,
    },
    { label: 'daily worker 180,000 × 1 day: 30,000 × 6% = 1,800 − 990 = 810 < 1,000 → 소액부징수', pay: 180_000, days: 1, tax: 0, local: 0, net: 180_000 - 1_620 },
    { label: 'daily worker 150,000 × 3 days: nothing above the deduction', pay: 450_000, days: 3, tax: 0, local: 0, net: 450_000 - 4_050 },
  ])('$label', ({ pay, days, tax, local, net }) => {
    const row = calculatePayrollRow({ incomeType: 'daily', attributionMonth: '2026-03', payAmount: pay, workDays: days, insurance: EI_ONLY }, rates)
    expect([row.incomeTax, row.localIncomeTax, row.netPay]).toEqual([tax, local, net])
  })

  it('warns when a daily worker reaches the social insurance threshold while exempt', () => {
    const row = calculatePayrollRow({ incomeType: 'daily', attributionMonth: '2026-03', payAmount: 1_600_000, workDays: 8, insurance: EI_ONLY }, rates)
    expect(row.warnings.map((warning) => warning.code)).toEqual(['DAILY_WORKER_SOCIAL_INSURANCE_REQUIRED'])
  })

  it.each([
    { label: 'business 1,000,000: 3% = 30,000, local 3,000, net 967,000', input: { payAmount: 1_000_000 }, gross: 1_000_000, tax: 30_000, net: 967_000 },
    { label: 'business after tax 967,000 grosses up to 1,000,000', input: { payAmount: 967_000, taxDeductionMode: 'after_tax' as const }, gross: 1_000_000, tax: 30_000, net: 967_000 },
    { label: 'business 30,000: 900 < 1,000 → 소액부징수', input: { payAmount: 30_000 }, gross: 30_000, tax: 0, net: 30_000 },
  ])('$label', ({ input, gross, tax, net }) => {
    const row = calculatePayrollRow({ incomeType: 'business', attributionMonth: '2026-03', ...input }, rates)
    expect([row.grossPay, row.incomeTax, row.netPay]).toEqual([gross, tax, net])
  })

  it('deducts artist employment insurance from business income: 1,000,000 × 0.8% = 8,000', () => {
    const row = calculatePayrollRow({ incomeType: 'business', attributionMonth: '2026-03', payAmount: 1_000_000, employmentInsurance: { applicable: true } }, rates)
    expect([row.insurance.employee.employmentInsurance, row.netPay]).toEqual([8_000, 959_000])
  })

  it.each([
    {
      label: 'other 1,000,000 with 60% expenses: (1,000,000 − 600,000) × 20% = 80,000, local 8,000, net 912,000',
      pay: 1_000_000,
      ratePpm: 600_000,
      tax: 80_000,
      local: 8_000,
      net: 912_000,
    },
    { label: 'other 125,000 with 60% expenses: income 50,000 ≤ 과세최저한', pay: 125_000, ratePpm: 600_000, tax: 0, local: 0, net: 125_000 },
    { label: 'other 1,000,000 without expenses: 200,000, local 20,000', pay: 1_000_000, ratePpm: 0, tax: 200_000, local: 20_000, net: 780_000 },
  ])('$label', ({ pay, ratePpm, tax, local, net }) => {
    const row = calculatePayrollRow({ incomeType: 'other', attributionMonth: '2026-03', payAmount: pay, necessaryExpense: { kind: 'deemed', ratePpm } }, rates)
    expect([row.incomeTax, row.localIncomeTax, row.netPay]).toEqual([tax, local, net])
  })

  it('subtracts company deduction items from net pay', () => {
    const row = calculatePayrollRow(
      { incomeType: 'business', attributionMonth: '2026-03', payAmount: 1_000_000, otherDeductions: [{ code: 'advance', name: '선지급금', amount: 100_000 }] },
      rates,
    )
    expect(row.netPay).toBe(867_000)
  })
})

describe('severance pay', () => {
  it('pays 30 days of average wage per year of service and withholds retirement income tax', () => {
    const result = calculateSeverancePay(
      { joinDate: toPlainDate('2024-01-01'), lastWorkDate: toPlainDate('2026-10-31'), threeMonthWages: 9_000_000 },
      rates,
    )
    expect(result).toMatchObject({
      eligible: true,
      serviceDays: 1_035,
      averageDailyWage: 97_826,
      severancePay: 8_321_917,
      retirementIncomeTax: 79_720,
      localIncomeTax: 7_970,
      netPay: 8_321_917 - 79_720 - 7_970,
    })
  })

  it('uses the ordinary daily wage when it is higher and refuses service under a year', () => {
    const ordinary = calculateSeverancePay(
      { joinDate: toPlainDate('2025-01-01'), lastWorkDate: toPlainDate('2025-12-31'), threeMonthWages: 6_000_000, ordinaryDailyWage: 100_000 },
      rates,
    )
    expect(ordinary).toMatchObject({ usedOrdinaryWage: true, serviceDays: 365, severancePay: 3_000_000 })
    const short = calculateSeverancePay({ joinDate: toPlainDate('2025-01-02'), lastWorkDate: toPlainDate('2025-12-31'), threeMonthWages: 9_000_000 }, rates)
    expect(short).toMatchObject({ eligible: false, severancePay: 0, retirementIncomeTax: 0 })
  })
})
