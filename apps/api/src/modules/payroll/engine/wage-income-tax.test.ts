import { describe, expect, it } from 'vitest'
import type { SimpleTaxStrategy } from './engine.types.ts'
import { RATES_2026_01, RATES_2026_03 } from './rate-tables-2026.ts'
import {
  annualSimpleTaxSteps,
  calculateWageIncomeTax,
  EXACT_FORMULA,
  MIDPOINT_FORMULA,
  OFFICIAL_TABLE,
} from './wage-income-tax.ts'

const rates = RATES_2026_01
const ONE_DEPENDANT = {
  method: 'TAX_TABLE',
  dependants: 1,
  childrenAged8To20: 0,
  withholdingRatePpm: 1_000_000,
} as const

describe('annualSimpleTaxSteps', () => {
  it('월 3,000,000원·공제대상가족 1명은 연간 산식을 단계별로 따릅니다', () => {
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
})

describe('calculateWageIncomeTax', () => {
  const cases: {
    label: string
    pay: number
    dependants: number
    children: number
    ratePpm: number
    strategy: SimpleTaxStrategy
    tax: number
    local: number
  }[] = [
    {
      label: '실제 급여 산식 3,000,000: 709,000 ÷ 12 = 59,083 → 59,080, 지방소득세 5,908 → 5,900',
      pay: 3_000_000,
      dependants: 1,
      children: 0,
      ratePpm: 1_000_000,
      strategy: EXACT_FORMULA,
      tax: 59_080,
      local: 5_900,
    },
    {
      label: '구간 중간값 3,000,000 (3,000,000–3,020,000 구간 → 3,010,000): 724,585 ÷ 12 = 60,382 → 60,380',
      pay: 3_000_000,
      dependants: 1,
      children: 0,
      ratePpm: 1_000_000,
      strategy: MIDPOINT_FORMULA,
      tax: 60_380,
      local: 6_030,
    },
    {
      label: '실제 급여 산식 3,000,000, 80% 선택: 59,080 × 80% = 47,264 → 47,260',
      pay: 3_000_000,
      dependants: 1,
      children: 0,
      ratePpm: 800_000,
      strategy: EXACT_FORMULA,
      tax: 47_260,
      local: 4_720,
    },
    {
      label: '실제 급여 산식 3,000,000, 120% 선택: 59,080 × 120% = 70,896 → 70,890',
      pay: 3_000_000,
      dependants: 1,
      children: 0,
      ratePpm: 1_200_000,
      strategy: EXACT_FORMULA,
      tax: 70_890,
      local: 7_080,
    },
    {
      label: '실제 급여 산식 3,000,000, 공제대상가족 2명·자녀 1명: 42,187 → 42,180 − 12,500 = 29,680',
      pay: 3_000_000,
      dependants: 2,
      children: 1,
      ratePpm: 1_000_000,
      strategy: EXACT_FORMULA,
      tax: 29_680,
      local: 2_960,
    },
    {
      label: '간이세액표 첫 구간(770,000) 미만이면 원천징수하지 않음',
      pay: 700_000,
      dependants: 1,
      children: 0,
      ratePpm: 1_000_000,
      strategy: MIDPOINT_FORMULA,
      tax: 0,
      local: 0,
    },
  ]
  it.each(cases)('$label', ({ pay, dependants, children, ratePpm, strategy, tax, local }) => {
    const result = calculateWageIncomeTax(
      pay,
      { method: 'TAX_TABLE', dependants, childrenAged8To20: children, withholdingRatePpm: ratePpm },
      rates,
      strategy,
    )

    expect([result.incomeTax, result.localIncomeTax]).toEqual([tax, local])
  })

  it('10,000,000원 초과분은 10,000,000원의 세액에 초과 산식을 더합니다', () => {
    const atThreshold = EXACT_FORMULA.monthlyTax(
      { monthlyTaxablePay: 10_000_000, dependants: 1, childrenAged8To20: 0 },
      rates,
    )
    const above = EXACT_FORMULA.monthlyTax(
      { monthlyTaxablePay: 12_000_000, dependants: 1, childrenAged8To20: 0 },
      rates,
    )

    expect(above - atThreshold).toBe(25_000 + 2_000_000 * 0.343)
  })

  it('직접 입력과 미적용을 따릅니다', () => {
    const manual = calculateWageIncomeTax(
      3_000_000,
      { ...ONE_DEPENDANT, method: 'MANUAL', manualAmount: 50_000 },
      rates,
      EXACT_FORMULA,
    )

    expect([manual.incomeTax, manual.localIncomeTax]).toEqual([50_000, 5_000])
    expect(
      calculateWageIncomeTax(3_000_000, { ...ONE_DEPENDANT, method: 'NONE' }, rates, EXACT_FORMULA).incomeTax,
    ).toBe(0)
  })

  it('중소기업 감면을 원천징수 비율보다 먼저, 남은 한도 안에서 적용합니다', () => {
    const reduced = calculateWageIncomeTax(
      3_000_000,
      { ...ONE_DEPENDANT, reduction: { ratePpm: 900_000, remainingAnnualLimit: 10_000 } },
      rates,
      EXACT_FORMULA,
    )

    expect(reduced.incomeTax).toBe(49_080)
  })
})

describe('공식 간이세액표(OFFICIAL_TABLE)', () => {
  const tax = (monthlyTaxablePay: number, dependants = 1, childrenAged8To20 = 0, table = rates) =>
    OFFICIAL_TABLE.monthlyTax({ monthlyTaxablePay, dependants, childrenAged8To20 }, table)

  it('표는 770천원부터 10,000천원 전까지 빈틈없이 이어지고 행 폭은 별표 제6호와 같습니다', () => {
    const { rows, atHighIncomeThreshold } = rates.wageIncomeTax.simpleTaxTable
    expect(rows).toHaveLength(146 + 150 + 350)
    expect(rows[0]?.min).toBe(rates.wageIncomeTax.tableMinimumPay)
    expect(rows.at(-1)?.max).toBe(rates.wageIncomeTax.highIncomeThreshold)
    expect(atHighIncomeThreshold).toHaveLength(11)
    rows.forEach((row, index) => {
      const band = rates.wageIncomeTax.tableRowBands.find(
        (candidate) => row.min >= candidate.from && row.min < candidate.to,
      )
      expect(row.max - row.min).toBe(band?.step)
      if (index > 0) expect(row.min).toBe(rows[index - 1]?.max)
      expect(row.taxes).toHaveLength(11)
      row.taxes.forEach((value, column) => {
        if (column > 0) expect(value).toBeLessThanOrEqual(row.taxes[column - 1] ?? 0)
        if (index > 0) expect(value).toBeGreaterThanOrEqual(rows[index - 1]?.taxes[column] ?? 0)
      })
    })
  })

  it('월 300만원은 공식 표 값이고 산식과 다릅니다', () => {
    expect(tax(3_000_000)).toBe(74_350)
    expect(tax(3_000_000, 2)).toBe(56_850)
    expect(tax(3_019_999)).toBe(74_350)
    expect(tax(3_020_000)).toBe(76_060)
    expect(EXACT_FORMULA.monthlyTax({ monthlyTaxablePay: 3_000_000, dependants: 1, childrenAged8To20: 0 }, rates)).toBe(
      59_080,
    )
  })

  it('첫 행보다 작은 급여는 0입니다', () => {
    expect(tax(769_999)).toBe(0)
    expect(tax(770_000)).toBe(0)
    expect(tax(1_500_000)).toBe(8_920)
  })

  it('자녀 공제는 지급월 기준표의 금액을 빼고 0 아래로 내려가지 않습니다', () => {
    expect(tax(3_000_000, 2, 1, RATES_2026_01)).toBe(56_850 - 12_500)
    expect(tax(3_000_000, 2, 1, RATES_2026_03)).toBe(56_850 - 20_830)
    expect(tax(3_000_000, 3, 3, RATES_2026_03)).toBe(Math.max(0, 31_940 - (45_830 + 33_330)))
    expect(tax(1_500_000, 1, 1)).toBe(0)
  })

  it('정확히 1천만원은 10,000천원 행이고 넘으면 별표 제6호 산식을 더합니다', () => {
    expect(tax(9_999_999)).toBe(1_503_990)
    expect(tax(10_000_000)).toBe(1_507_400)
    expect(tax(10_000_000, 2)).toBe(1_431_570)
    expect(tax(12_000_000, 2)).toBe(1_431_570 + 25_000 + 686_000)
    expect(tax(15_000_000)).toBe(1_507_400 + 1_397_000 + 372_400)
    expect(tax(50_000_000)).toBe(1_507_400 + 13_394_600 + 2_100_000)
    expect(tax(10_000_001)).toBe(1_507_400 + 25_000)
  })

  it('공제대상가족이 11명을 넘으면 11명 세액에서 (10명 − 11명) × 넘는 인원을 뺍니다', () => {
    expect(tax(5_000_000, 11)).toBe(87_850)
    expect(tax(5_000_000, 13)).toBe(87_850 - (106_600 - 87_850) * 2)
    expect(tax(5_000_000, 30)).toBe(0)
    expect(tax(10_000_000, 12)).toBe(960_840 - (990_840 - 960_840))
  })

  it('원천징수 비율과 지방소득세는 표 값에 적용합니다', () => {
    const at = (withholdingRatePpm: number) =>
      calculateWageIncomeTax(3_000_000, { ...ONE_DEPENDANT, withholdingRatePpm }, rates, OFFICIAL_TABLE)
    expect(at(1_000_000)).toMatchObject({ incomeTax: 74_350, localIncomeTax: 7_430 })
    expect(at(800_000)).toMatchObject({ incomeTax: 59_480, localIncomeTax: 5_940 })
    expect(at(1_200_000)).toMatchObject({ incomeTax: 89_220, localIncomeTax: 8_920 })
  })
})
