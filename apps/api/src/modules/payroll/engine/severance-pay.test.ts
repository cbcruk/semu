import { describe, expect, it } from 'vitest'
import { RATES_2026_01 } from './rate-tables-2026.ts'
import { addMonthsToDate, averageWagePeriodDays, calculateSeverancePay } from './severance-pay.ts'

const rates = RATES_2026_01

describe('calculateSeverancePay', () => {
  it('계속근로 1년마다 평균임금 30일분을 주고 퇴직소득세를 원천징수합니다', () => {
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

  it('통상임금 일액이 더 많으면 그것을 평균임금으로 씁니다', () => {
    const result = calculateSeverancePay(
      { joinDate: '2025-01-01', lastWorkDate: '2025-12-31', threeMonthWages: 6_000_000, ordinaryDailyWage: 100_000 },
      rates,
    )

    expect(result).toMatchObject({ usedOrdinaryWage: true, serviceDays: 365, severancePay: 3_000_000 })
  })

  it('계속근로 1년 미만이면 퇴직금이 0원입니다', () => {
    const result = calculateSeverancePay(
      { joinDate: '2025-01-02', lastWorkDate: '2025-12-31', threeMonthWages: 9_000_000 },
      rates,
    )

    expect(result).toMatchObject({ eligible: false, severancePay: 0, retirementIncomeTax: 0 })
  })

  it('중간정산 뒤에는 기산일부터 근속일수를 세고, 1년 이상인지는 입사일로 봅니다', () => {
    const result = calculateSeverancePay(
      {
        joinDate: '2024-01-01',
        serviceStartDate: '2026-02-01',
        lastWorkDate: '2026-10-31',
        threeMonthWages: 9_000_000,
      },
      rates,
    )

    // 2026-02-01 ~ 2026-10-31 = 273일, 9,000,000 × 30 × 273 ÷ (92 × 365)
    expect(result).toMatchObject({ eligible: true, serviceDays: 273, severancePay: 2_195_056 })
  })
})

describe('averageWagePeriodDays', () => {
  it('마지막 근무일 다음 날 이전 3개월의 역일수를 셉니다', () => {
    expect(averageWagePeriodDays('2026-10-31')).toBe(92)
  })

  it('짧은 달이면 그달 말일로 맞춥니다', () => {
    expect(addMonthsToDate('2026-05-31', -3)).toBe('2026-02-28')
  })
})
