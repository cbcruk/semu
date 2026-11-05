import { describe, expect, it } from 'vitest'
import { RATES_2026_01 } from './rate-tables-2026.ts'
import { addMonthsToDate, averageWagePeriodDays, calculateSeverancePay } from './severance-pay.ts'

const rates = RATES_2026_01

describe('calculateSeverancePay', () => {
  it('pays 30 days of average wage per year of service and withholds retirement income tax', () => {
    const result = calculateSeverancePay(
      { joinDate: '2024-01-01', lastWorkDate: '2026-10-31', threeMonthWages: 9_000_000 },
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

  it('uses the ordinary daily wage when it is higher', () => {
    const result = calculateSeverancePay(
      { joinDate: '2025-01-01', lastWorkDate: '2025-12-31', threeMonthWages: 6_000_000, ordinaryDailyWage: 100_000 },
      rates,
    )

    expect(result).toMatchObject({ usedOrdinaryWage: true, serviceDays: 365, severancePay: 3_000_000 })
  })

  it('refuses service under a year', () => {
    const result = calculateSeverancePay(
      { joinDate: '2025-01-02', lastWorkDate: '2025-12-31', threeMonthWages: 9_000_000 },
      rates,
    )

    expect(result).toMatchObject({ eligible: false, severancePay: 0, retirementIncomeTax: 0 })
  })
})

describe('averageWagePeriodDays', () => {
  it('counts the three calendar months before the day after the last work day', () => {
    expect(averageWagePeriodDays('2026-10-31')).toBe(92)
  })

  it('clamps to the last day of a shorter month', () => {
    expect(addMonthsToDate('2026-05-31', -3)).toBe('2026-02-28')
  })
})
