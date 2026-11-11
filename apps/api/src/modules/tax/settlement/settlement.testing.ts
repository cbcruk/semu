import type {
  BalanceSheetInputMonth,
  CashAccount,
  CashFlowInputMonth,
  PartnerLedger,
  ProfitLossInputMonth,
  ProfitLossSectionAmount,
} from './settlement-report.types.ts'

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

/** 테스트 기초 잔액입니다. 현금 100만원, 보통예금 5,000만원이고 나머지는 0입니다. */
export const OPENING_BALANCES: Readonly<Record<CashAccount, number>> = {
  CASH: 1_000_000,
  CHECKING_DEPOSIT: 0,
  ORDINARY_DEPOSIT: 50_000_000,
  OTHER_DEPOSITS: 0,
}

/**
 * `from`부터 `count`달의 테스트 자금 흐름입니다. 잔액이 맞게 이어집니다. 달마다 보통예금에 2,000만원이 들어오고
 * 1,500만원이 나가며, 현금은 10만원을 씁니다. 다른 계정은 움직이지 않습니다.
 */
export function cashFlowMonths(
  from: string,
  count: number,
  opening: Readonly<Record<CashAccount, number>> = OPENING_BALANCES,
): CashFlowInputMonth[] {
  const balances = { ...opening }
  const [year, month] = from.split('-').map(Number) as [number, number]
  return Array.from({ length: count }, (_, offset) => {
    const index = year * 12 + (month - 1) + offset
    balances.CASH -= 100_000
    balances.ORDINARY_DEPOSIT += 20_000_000 - 15_000_000
    return {
      month: `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
      accounts: {
        CASH: { inflow: 0, outflow: 100_000, closingBalance: balances.CASH },
        CHECKING_DEPOSIT: { inflow: 0, outflow: 0, closingBalance: balances.CHECKING_DEPOSIT },
        ORDINARY_DEPOSIT: { inflow: 20_000_000, outflow: 15_000_000, closingBalance: balances.ORDINARY_DEPOSIT },
        OTHER_DEPOSITS: { inflow: 0, outflow: 0, closingBalance: balances.OTHER_DEPOSITS },
      },
    }
  })
}

/**
 * 테스트용 한 달 말 재무상태입니다. 자산 1억(유동 5,000만: 현금 2,000만·매출채권 2,000만·재고 1,000만, 비유동 5,000만),
 * 부채 4,000만(유동 2,500만, 비유동 1,500만), 자본 6,000만(자본금 5,000만, 이익잉여금 1,000만)입니다.
 */
export function balanceSheetMonth(
  month: string,
  overrides: Partial<Omit<BalanceSheetInputMonth, 'month'>> = {},
): BalanceSheetInputMonth {
  return {
    month,
    groups: {
      CURRENT_ASSETS: {
        amount: 50_000_000,
        accounts: [
          { name: '현금및현금성자산', amount: 20_000_000 },
          { name: '매출채권', amount: 20_000_000 },
          { name: '재고자산', amount: 10_000_000 },
        ],
      },
      NON_CURRENT_ASSETS: { amount: 50_000_000, accounts: [] },
      CURRENT_LIABILITIES: { amount: 25_000_000, accounts: [] },
      NON_CURRENT_LIABILITIES: { amount: 15_000_000, accounts: [] },
      CAPITAL_STOCK: { amount: 50_000_000, accounts: [] },
      CAPITAL_SURPLUS: emptySection,
      CAPITAL_ADJUSTMENTS: emptySection,
      ACCUMULATED_OTHER_COMPREHENSIVE_INCOME: emptySection,
      RETAINED_EARNINGS: { amount: 10_000_000, accounts: [] },
    },
    inventories: 10_000_000,
    tradeReceivables: 20_000_000,
    ...overrides,
  }
}

/** `from`부터 `count`달의 테스트 재무상태입니다. 달마다 같은 잔액입니다. */
export function balanceSheetMonths(from: string, count: number): BalanceSheetInputMonth[] {
  return profitLossMonths(from, count).map(({ month }) => balanceSheetMonth(month))
}

/**
 * 테스트용 거래처 원장입니다. 미수는 두 거래처(A001: 이월 300만, 1월 500만 발생·2월 400만 회수, A002: 이월 0, 3월 200만 발생),
 * 미지급은 한 거래처(B001: 이월 100만, 1월 100만 지급)입니다. 날짜는 `year`의 1–3월입니다.
 */
export function partnerLedgers(year: number): { receivables: PartnerLedger[]; payables: PartnerLedger[] } {
  return {
    receivables: [
      {
        partnerCode: 'A001',
        partnerName: '가나상사',
        openingBalance: 3_000_000,
        entries: [
          { date: `${year}-02-10`, summary: '외상대금 회수', increase: 0, decrease: 4_000_000 },
          { date: `${year}-01-15`, summary: '상품 매출', increase: 5_000_000, decrease: 0 },
        ],
      },
      {
        partnerCode: 'A002',
        partnerName: '다라유통',
        openingBalance: 0,
        entries: [{ date: `${year}-03-20`, summary: null, increase: 2_000_000, decrease: 0 }],
      },
    ],
    payables: [
      {
        partnerCode: 'B001',
        partnerName: '마바물산',
        openingBalance: 1_000_000,
        entries: [{ date: `${year}-01-25`, summary: '원재료 대금 지급', increase: 0, decrease: 1_000_000 }],
      },
    ],
  }
}
