import { describe, expect, it } from 'vitest'
import type { SocialInsuranceInput } from './engine.types.ts'
import { BUILT_IN_RATE_TABLES, RATES_2026_01 } from './rate-tables-2026.ts'
import { resolveRateTable, unverifiedRatePaths } from './rate-table.ts'
import { calculateSocialInsurance } from './social-insurance.ts'

const rates = RATES_2026_01
const RATE: Omit<SocialInsuranceInput, 'insurablePay'> = {
  nationalPension: { mode: 'RATE' },
  healthInsurance: { mode: 'RATE' },
  employmentInsurance: { mode: 'RATE' },
}

describe('rate tables', () => {
  it('resolves the table in force by month', () => {
    expect(resolveRateTable(BUILT_IN_RATE_TABLES, '2026-01').effectiveFrom).toBe('2026-01')
    expect(resolveRateTable(BUILT_IN_RATE_TABLES, '2026-02').effectiveFrom).toBe('2026-01')
    expect(resolveRateTable(BUILT_IN_RATE_TABLES, '2026-03').effectiveFrom).toBe('2026-03')
    expect(resolveRateTable(BUILT_IN_RATE_TABLES, '2026-06').effectiveFrom).toBe('2026-03')
    expect(resolveRateTable(BUILT_IN_RATE_TABLES, '2026-07').effectiveFrom).toBe('2026-07')
    expect(resolveRateTable(BUILT_IN_RATE_TABLES, '2026-10').effectiveFrom).toBe('2026-07')
    expect(resolveRateTable(BUILT_IN_RATE_TABLES, '2026-11').effectiveFrom).toBe('2026-11')
    expect(resolveRateTable(BUILT_IN_RATE_TABLES, '2027-01').effectiveFrom).toBe('2026-11')
    expect(() => resolveRateTable(BUILT_IN_RATE_TABLES, '2025-12')).toThrow(RangeError)
  })

  it('records provenance for every rate group and flags source-confirmed values as verified', () => {
    const paths = Object.keys(rates.verification)
    for (const group of [
      'minimumWage',
      'nationalPension',
      'healthInsurance',
      'longTermCare',
      'employmentInsurance',
      'wageIncomeTax',
      'dailyWorker',
      'nonTaxable',
    ]) {
      expect(paths.some((path) => path.startsWith(`${group}.`))).toBe(true)
    }
    const unverified = unverifiedRatePaths(rates)
    expect(unverified).not.toContain('longTermCare.ratioOfHealthPpm')
    expect(unverified).toContain('employmentInsurance.premiumRoundingUnit')
    expect(unverified).toContain('wageIncomeTax.simpleTaxStrategy')
    expect(unverified).not.toContain('nationalPension.baseMax')
    expect(unverified).not.toContain('nationalPension.employeeRatePpm')
    expect(unverified).not.toContain('minimumWage.hourly')
  })

  it('versions the July 2026 pension base limits and the March 2026 child credits', () => {
    const march = resolveRateTable(BUILT_IN_RATE_TABLES, '2026-03')
    const july = resolveRateTable(BUILT_IN_RATE_TABLES, '2026-07')

    expect([rates.nationalPension.baseMin, rates.nationalPension.baseMax]).toEqual([400_000, 6_370_000])
    expect([july.nationalPension.baseMin, july.nationalPension.baseMax]).toEqual([410_000, 6_590_000])
    expect(rates.wageIncomeTax.childCreditMonthly).toEqual({ one: 12_500, two: 29_160, perAdditional: 25_000 })
    expect(march.wageIncomeTax.childCreditMonthly).toEqual({ one: 20_830, two: 45_830, perAdditional: 33_330 })
    expect(july.wageIncomeTax.childCreditMonthly).toEqual(march.wageIncomeTax.childCreditMonthly)
    expect(BUILT_IN_RATE_TABLES.every((table) => unverifiedRatePaths(table).length > 0)).toBe(true)
  })

  it('confirms the long-term care ratio from the 2026 press release, then from 법률 제21690호 부칙 제3조 in November', () => {
    const october = resolveRateTable(BUILT_IN_RATE_TABLES, '2026-10')
    const november = resolveRateTable(BUILT_IN_RATE_TABLES, '2026-11')

    expect(november.longTermCare.ratioOfHealthPpm).toBe(131_400)
    expect(october.longTermCare.ratioOfHealthPpm).toBe(131_400)
    expect(unverifiedRatePaths(october)).not.toContain('longTermCare.ratioOfHealthPpm')
    expect(october.verification['longTermCare.ratioOfHealthPpm']?.source).toContain('13.14%')
    expect(unverifiedRatePaths(november)).not.toContain('longTermCare.ratioOfHealthPpm')
    expect(november.verification['longTermCare.ratioOfHealthPpm']?.source).toContain('부칙 제3조')
    expect(november.nationalPension).toEqual(october.nationalPension)
  })
})

describe('calculateSocialInsurance', () => {
  it.each([
    {
      label: '3,000,000: NPS 142,500; NHIS 107,850; LTC 14,171.49 → 14,170; EI 27,000',
      pay: 3_000_000,
      expected: [142_500, 107_850, 14_170, 27_000],
    },
    {
      label: 'NPS cap: 8,000,000 → base 6,370,000 × 4.75% = 302,575 → 302,570',
      pay: 8_000_000,
      expected: [302_570, 287_600, 37_790, 72_000],
    },
    {
      label: 'NPS floor: 300,000 → base 400,000 × 4.75% = 19,000',
      pay: 300_000,
      expected: [19_000, 10_780, 1_410, 2_700],
    },
    {
      label: 'NPS base truncated below 1,000: 3,456,789 → 3,456,000',
      pay: 3_456_789,
      expected: [164_160, 124_270, 16_320, 31_110],
    },
  ])('$label', ({ pay, expected }) => {
    const { employee } = calculateSocialInsurance({ ...RATE, insurablePay: pay }, rates)

    expect([
      employee.nationalPension,
      employee.healthInsurance,
      employee.longTermCare,
      employee.employmentInsurance,
    ]).toEqual(expected)
  })

  it('uses the July 2026 pension limits from that month', () => {
    const july = resolveRateTable(BUILT_IN_RATE_TABLES, '2026-07')
    const cap = calculateSocialInsurance({ ...RATE, insurablePay: 8_000_000 }, july)
    const floor = calculateSocialInsurance({ ...RATE, insurablePay: 300_000 }, july)

    // 6,590,000 × 4.75% = 313,025 → 313,020; 410,000 × 4.75% = 19,475 → 19,470
    expect(cap.employee.nationalPension).toBe(313_020)
    expect(floor.employee.nationalPension).toBe(19_470)
  })

  it('adds the employer stability rate and the industrial accident rate on the employer side only', () => {
    const { employee, employer } = calculateSocialInsurance(
      { ...RATE, insurablePay: 3_000_000, industrialAccidentRatePpm: 7_000 },
      rates,
    )

    expect(employer.employmentInsurance).toBe(34_500)
    expect(employer.industrialAccident).toBe(21_000)
    expect(employee.industrialAccident).toBe(0)
    expect(employer.total).toBe(142_500 + 107_850 + 14_170 + 34_500 + 21_000)
  })

  it('takes noticed amounts as is and skips exempt insurances', () => {
    const result = calculateSocialInsurance(
      {
        insurablePay: 3_000_000,
        nationalPension: { mode: 'NOTICE', noticeAmount: 135_000 },
        healthInsurance: { mode: 'NOTICE', noticeAmount: 100_000, longTermCareNoticeAmount: 13_000 },
        employmentInsurance: { mode: 'EXEMPT' },
      },
      rates,
    )

    expect(result.employee).toMatchObject({
      nationalPension: 135_000,
      healthInsurance: 100_000,
      longTermCare: 13_000,
      employmentInsurance: 0,
      total: 248_000,
    })
    expect(result.employer.nationalPension).toBe(135_000)
  })

  it('uses the artist rate on both sides for 예술인·노무제공자', () => {
    const result = calculateSocialInsurance(
      {
        insurablePay: 1_000_000,
        nationalPension: { mode: 'EXEMPT' },
        healthInsurance: { mode: 'EXEMPT' },
        employmentInsurance: { mode: 'RATE', kind: 'ARTIST' },
        industrialAccidentRatePpm: 0,
      },
      rates,
    )

    expect([result.employee.employmentInsurance, result.employer.employmentInsurance]).toEqual([8_000, 8_000])
  })
})
