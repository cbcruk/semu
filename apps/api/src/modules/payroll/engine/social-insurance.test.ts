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

describe('기준표', () => {
  it('달마다 그때 시행 중인 기준표를 고릅니다', () => {
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

  it('요율 묶음마다 출처를 적고 원문으로 확인한 값은 확인됨으로 표시합니다', () => {
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

  it('2026년 7월 국민연금 기준소득월액 상·하한과 2026년 3월 자녀세액공제를 따로 둡니다', () => {
    const march = resolveRateTable(BUILT_IN_RATE_TABLES, '2026-03')
    const july = resolveRateTable(BUILT_IN_RATE_TABLES, '2026-07')

    expect([rates.nationalPension.baseMin, rates.nationalPension.baseMax]).toEqual([400_000, 6_370_000])
    expect([july.nationalPension.baseMin, july.nationalPension.baseMax]).toEqual([410_000, 6_590_000])
    expect(rates.wageIncomeTax.childCreditMonthly).toEqual({ one: 12_500, two: 29_160, perAdditional: 25_000 })
    expect(march.wageIncomeTax.childCreditMonthly).toEqual({ one: 20_830, two: 45_830, perAdditional: 33_330 })
    expect(july.wageIncomeTax.childCreditMonthly).toEqual(march.wageIncomeTax.childCreditMonthly)
    expect(BUILT_IN_RATE_TABLES.every((table) => unverifiedRatePaths(table).length > 0)).toBe(true)
  })

  it('장기요양보험 비율은 2026년 보도자료로, 11월부터는 법률 제21690호 부칙 제3조로 확인합니다', () => {
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
      label: '3,000,000: 국민연금 142,500, 건강보험 107,850, 장기요양 14,171.49 → 14,170, 고용보험 27,000',
      pay: 3_000_000,
      expected: [142_500, 107_850, 14_170, 27_000],
    },
    {
      label: '국민연금 상한: 8,000,000 → 기준소득월액 6,370,000 × 4.75% = 302,575 → 302,570',
      pay: 8_000_000,
      expected: [302_570, 287_600, 37_790, 72_000],
    },
    {
      label: '국민연금 하한: 300,000 → 기준소득월액 400,000 × 4.75% = 19,000',
      pay: 300_000,
      expected: [19_000, 10_780, 1_410, 2_700],
    },
    {
      label: '국민연금 기준소득월액은 천 원 미만을 버림: 3,456,789 → 3,456,000',
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

  it('2026년 7월부터 그달의 국민연금 상·하한을 씁니다', () => {
    const july = resolveRateTable(BUILT_IN_RATE_TABLES, '2026-07')
    const cap = calculateSocialInsurance({ ...RATE, insurablePay: 8_000_000 }, july)
    const floor = calculateSocialInsurance({ ...RATE, insurablePay: 300_000 }, july)

    // 6,590,000 × 4.75% = 313,025 → 313,020; 410,000 × 4.75% = 19,475 → 19,470
    expect(cap.employee.nationalPension).toBe(313_020)
    expect(floor.employee.nationalPension).toBe(19_470)
  })

  it('고용안정·직업능력개발 요율과 산재보험 요율은 사업주 부담에만 더합니다', () => {
    const { employee, employer } = calculateSocialInsurance(
      { ...RATE, insurablePay: 3_000_000, industrialAccidentRatePpm: 7_000 },
      rates,
    )

    expect(employer.employmentInsurance).toBe(34_500)
    expect(employer.industrialAccident).toBe(21_000)
    expect(employee.industrialAccident).toBe(0)
    expect(employer.total).toBe(142_500 + 107_850 + 14_170 + 34_500 + 21_000)
  })

  it('고지 금액은 그대로 쓰고 미적용 보험은 건너뜁니다', () => {
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

  it('예술인·노무제공자는 근로자·사업주 모두 예술인 요율을 씁니다', () => {
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
