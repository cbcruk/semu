import type { ProfitLossInputMonth, ProfitLossSectionAmount } from './settlement-report.types.ts'

const emptySection: ProfitLossSectionAmount = { amount: 0, accounts: [] }

/**
 * 테스트용 한 달 손익입니다. 매출 1,000만원(상품매출), 매출원가 400만원, 판관비 300만원(직원급여 200·복리후생비 100),
 * 영업외수익 10만원, 영업외비용 0, 법인세등 50만원이라 당기순이익은 260만원입니다. `overrides`로 섹션을 바꿉니다.
 */
export function profitLossMonth(
  month: string,
  overrides: Partial<ProfitLossInputMonth['sections']> = {},
): ProfitLossInputMonth {
  return {
    month,
    sections: {
      REVENUE: { amount: 10_000_000, accounts: [{ name: '상품매출', amount: 10_000_000 }] },
      COST_OF_SALES: { amount: 4_000_000, accounts: [] },
      SELLING_AND_ADMINISTRATIVE_EXPENSES: {
        amount: 3_000_000,
        accounts: [
          { name: '직원급여', amount: 2_000_000 },
          { name: '복리후생비', amount: 1_000_000 },
        ],
      },
      NON_OPERATING_INCOME: { amount: 100_000, accounts: [{ name: '이자수익', amount: 100_000 }] },
      NON_OPERATING_EXPENSES: emptySection,
      INCOME_TAXES: { amount: 500_000, accounts: [] },
      ...overrides,
    },
  }
}

/** `from`부터 `count`달의 테스트 손익입니다. */
export function profitLossMonths(from: string, count: number): ProfitLossInputMonth[] {
  const [year, month] = from.split('-').map(Number) as [number, number]
  return Array.from({ length: count }, (_, offset) => {
    const index = year * 12 + (month - 1) + offset
    return profitLossMonth(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`)
  })
}
