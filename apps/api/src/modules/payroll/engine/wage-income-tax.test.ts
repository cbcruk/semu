import { describe, expect, it } from 'vitest'
import type { SimpleTaxStrategy } from './engine.types.ts'
import { RATES_2026_01 } from './rate-tables-2026.ts'
import {
  annualSimpleTaxSteps,
  calculateWageIncomeTax,
  EXACT_FORMULA,
  generateSimpleTaxTable,
  lookupSimpleTaxTable,
  MIDPOINT_FORMULA,
} from './wage-income-tax.ts'

const rates = RATES_2026_01
const ONE_DEPENDANT = {
  method: 'TAX_TABLE',
  dependants: 1,
  childrenAged8To20: 0,
  withholdingRatePpm: 1_000_000,
} as const

describe('annualSimpleTaxSteps', () => {
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
      label: 'exact 3,000,000: 709,000 ÷ 12 = 59,083 → 59,080; local 5,908 → 5,900',
      pay: 3_000_000,
      dependants: 1,
      children: 0,
      ratePpm: 1_000_000,
      strategy: EXACT_FORMULA,
      tax: 59_080,
      local: 5_900,
    },
    {
      label: 'midpoint 3,000,000 (row 3,000,000–3,020,000 → 3,010,000): 724,585 ÷ 12 = 60,382 → 60,380',
      pay: 3_000_000,
      dependants: 1,
      children: 0,
      ratePpm: 1_000_000,
      strategy: MIDPOINT_FORMULA,
      tax: 60_380,
      local: 6_030,
    },
    {
      label: 'exact 3,000,000 at 80%: 59,080 × 80% = 47,264 → 47,260',
      pay: 3_000_000,
      dependants: 1,
      children: 0,
      ratePpm: 800_000,
      strategy: EXACT_FORMULA,
      tax: 47_260,
      local: 4_720,
    },
    {
      label: 'exact 3,000,000 at 120%: 59,080 × 120% = 70,896 → 70,890',
      pay: 3_000_000,
      dependants: 1,
      children: 0,
      ratePpm: 1_200_000,
      strategy: EXACT_FORMULA,
      tax: 70_890,
      local: 7_080,
    },
    {
      label: 'exact 3,000,000, two dependants, one child: 42,187 → 42,180 − 12,500 = 29,680',
      pay: 3_000_000,
      dependants: 2,
      children: 1,
      ratePpm: 1_000_000,
      strategy: EXACT_FORMULA,
      tax: 29_680,
      local: 2_960,
    },
    {
      label: 'below the first table row (770,000) nothing is withheld',
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

  it('adds the over-10,000,000 formula on top of the tax at 10,000,000', () => {
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

  it('honours manual input and none', () => {
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

  it('applies the 중소기업 감면 before the withholding ratio, capped by the remaining limit', () => {
    const reduced = calculateWageIncomeTax(
      3_000_000,
      { ...ONE_DEPENDANT, reduction: { ratePpm: 900_000, remainingAnnualLimit: 10_000 } },
      rates,
      EXACT_FORMULA,
    )

    expect(reduced.incomeTax).toBe(49_080)
  })
})

describe('simple tax tables', () => {
  it('lets an official table replace the formula', () => {
    const strategy = lookupSimpleTaxTable(
      [{ min: 3_000_000, max: 3_020_000, taxes: [74_350, 56_850] }],
      MIDPOINT_FORMULA,
    )

    expect(strategy.monthlyTax({ monthlyTaxablePay: 3_010_000, dependants: 1, childrenAged8To20: 0 }, rates)).toBe(
      74_350,
    )
    expect(strategy.monthlyTax({ monthlyTaxablePay: 3_010_000, dependants: 2, childrenAged8To20: 1 }, rates)).toBe(
      56_850 - 12_500,
    )
    expect(strategy.monthlyTax({ monthlyTaxablePay: 2_000_000, dependants: 1, childrenAged8To20: 0 }, rates)).toBe(0)
    expect(strategy.monthlyTax({ monthlyTaxablePay: 5_000_000, dependants: 1, childrenAged8To20: 0 }, rates)).toBe(
      MIDPOINT_FORMULA.monthlyTax({ monthlyTaxablePay: 5_000_000, dependants: 1, childrenAged8To20: 0 }, rates),
    )
  })

  it('generates rows with the official band widths and non-increasing tax by dependants', () => {
    const rows = generateSimpleTaxTable(rates)
    const row = rows.find((candidate) => candidate.min === 3_000_000)

    expect(rows).toHaveLength(146 + 150 + 350)
    expect(row?.max).toBe(3_020_000)
    expect(row?.taxes[0]).toBe(60_380)
    for (const candidate of rows) {
      for (let index = 1; index < candidate.taxes.length; index += 1) {
        expect(candidate.taxes[index]).toBeLessThanOrEqual(candidate.taxes[index - 1] ?? 0)
      }
    }
  })
})
