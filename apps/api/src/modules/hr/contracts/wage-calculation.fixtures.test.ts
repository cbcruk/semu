import { describe, expect, it } from 'vitest'
import { MULTIPLIERS_FIVE_OR_MORE, MULTIPLIERS_UNDER_FIVE } from '../../payroll/payroll.public.ts'
import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { calculateWage } from './wage-calculation.ts'
import type { WageInput } from './wage-calculation.types.ts'

/**
 * 결정 1(2026-11-08): 자동계산 고정수당에 사업장 규모에 맞는 Payroll 지급배수를 곱합니다. 픽스처 입력에는 규모가 없어
 * 급여 설정 기본값인 5명 이상(`MULTIPLIERS_FIVE_OR_MORE`)으로 돌립니다. 현행은 모두 1.0배였습니다.
 *
 * 고정 시간 = 209 + 30 × 1.5 + 5 × 0.5 = 256.5, 통상시급 = 5,250,000 ÷ 256.5 = 20,467.84원입니다. 고정수당을 원 단위로
 * 반올림한 뒤 기본급을 역산하므로 기준시급(4,277,777 ÷ 209)은 20,467.83원으로 1전 다릅니다.
 */
const CHANGED = {
  'auto fixed overtime 30h and night 5h': {
    baseSalary: 4_277_777,
    baseHourlyWage: 20467.83,
    ordinaryHourlyWage: 20467.84,
    fixedAllowanceAmounts: { overtime: 921_053, night: 51_170, holiday: 0, holidayOvertime: 0 },
    minimumWageHourly: 20467.83,
    isBelowMinimumWage: false,
  },
}

describeRuleFixture(
  'payroll-contract-wage',
  (input: { wage: Omit<WageInput, 'premiumMultipliers'> }) =>
    calculateWage({ ...input.wage, premiumMultipliers: MULTIPLIERS_FIVE_OR_MORE }),
  CHANGED,
)

describe('사업장 규모에 따른 고정수당 가산', () => {
  const off = { enabled: false, hours: 0, amount: 0 }
  const monthlyAuto: Omit<WageInput, 'premiumMultipliers'> = {
    wageType: 'MONTHLY',
    amount: 3_000_000,
    monthlyWorkHours: 209,
    paymentItems: [],
    fixedAllowanceAutoCalc: true,
    fixedAllowances: {
      overtime: { enabled: true, hours: 10, amount: 0 },
      night: { enabled: true, hours: 4, amount: 0 },
      holiday: { enabled: true, hours: 8, amount: 0 },
      holidayOvertime: { enabled: true, hours: 2, amount: 0 },
    },
    minimumHourlyWage: 10_320,
  }

  it('상시 5명 이상이면 연장 1.5배, 야간 0.5배, 휴일 1.5배, 휴일 8시간 초과 2배를 곱합니다', () => {
    const result = calculateWage({ ...monthlyAuto, premiumMultipliers: MULTIPLIERS_FIVE_OR_MORE })

    // 209 + 10 × 1.5 + 4 × 0.5 + 8 × 1.5 + 2 × 2 = 242시간
    const ordinaryHourly = 3_000_000 / 242
    expect(result.ordinaryHourlyWage).toBe(12396.69)
    expect(result.fixedAllowanceAmounts).toEqual({
      overtime: Math.round(ordinaryHourly * 15),
      night: Math.round(ordinaryHourly * 2),
      holiday: Math.round(ordinaryHourly * 12),
      holidayOvertime: Math.round(ordinaryHourly * 4),
    })
    expect(result.baseSalary + Object.values(result.fixedAllowanceAmounts).reduce((a, b) => a + b, 0)).toBe(3_000_000)
  })

  it('상시 4명 이하면 가산 없이 연장·휴일·휴일연장 1배이고 야간 가산은 없습니다', () => {
    const result = calculateWage({ ...monthlyAuto, premiumMultipliers: MULTIPLIERS_UNDER_FIVE })

    // 209 + 10 + 0 + 8 + 2 = 229시간
    const ordinaryHourly = 3_000_000 / 229
    expect(result.ordinaryHourlyWage).toBe(13100.44)
    expect(result.fixedAllowanceAmounts).toEqual({
      overtime: Math.round(ordinaryHourly * 10),
      night: 0,
      holiday: Math.round(ordinaryHourly * 8),
      holidayOvertime: Math.round(ordinaryHourly * 2),
    })
  })

  it('수동 입력 고정수당은 사업장 규모와 관계없이 입력 금액을 씁니다', () => {
    const manual = {
      ...monthlyAuto,
      fixedAllowanceAutoCalc: false,
      fixedAllowances: {
        overtime: { enabled: true, hours: 10, amount: 200_000 },
        night: off,
        holiday: off,
        holidayOvertime: off,
      },
    }

    const fiveOrMore = calculateWage({ ...manual, premiumMultipliers: MULTIPLIERS_FIVE_OR_MORE })
    const underFive = calculateWage({ ...manual, premiumMultipliers: MULTIPLIERS_UNDER_FIVE })

    expect(fiveOrMore).toEqual(underFive)
    expect(fiveOrMore.fixedAllowanceAmounts.overtime).toBe(200_000)
  })
})
