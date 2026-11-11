import { describe, expect, it } from 'vitest'
import { deriveCashFlowMonth, validateCashFlowUpload } from './cash-flow-rules.ts'
import { cashFlowMonths, OPENING_BALANCES } from './settlement.testing.ts'
import { fiscalPeriod } from './settlement-rules.ts'

const period = fiscalPeriod(2026, 12)
const today = '2026-11-11'

describe('자금 흐름 업로드 검증', () => {
  it('잔액이 기초 잔액부터 이어지면 통과합니다', () => {
    const upload = {
      closedThrough: '2026-10-31',
      openingBalances: OPENING_BALANCES,
      months: cashFlowMonths('2026-01', 10),
    }

    expect(validateCashFlowUpload(upload, period, today)).toBeUndefined()
  })

  it('달 순서가 섞여 와도 달 순서로 잔액을 잇습니다', () => {
    const upload = {
      closedThrough: '2026-03-31',
      openingBalances: OPENING_BALANCES,
      months: cashFlowMonths('2026-01', 3).toReversed(),
    }

    expect(validateCashFlowUpload(upload, period, today)).toBeUndefined()
  })

  it('결산 기준일과 월 목록은 손익계산서와 같은 규칙으로 봅니다', () => {
    const upload = {
      closedThrough: '2026-03-31',
      openingBalances: OPENING_BALANCES,
      months: cashFlowMonths('2026-01', 2),
    }

    expect(validateCashFlowUpload(upload, period, today)).toEqual({ reason: 'MONTH_MISSING', field: 'months' })
  })

  it('첫 달 잔액이 기초 잔액과 이어지지 않으면 거절합니다', () => {
    const upload = {
      closedThrough: '2026-01-31',
      openingBalances: { ...OPENING_BALANCES, CASH: 0 },
      months: cashFlowMonths('2026-01', 1),
    }

    expect(validateCashFlowUpload(upload, period, today)).toEqual({
      reason: 'CASH_BALANCE_MISMATCH',
      field: 'months[0].accounts.CASH.closingBalance',
    })
  })

  it('중간 달 잔액이 어긋나면 그 달을 가리킵니다', () => {
    const months = cashFlowMonths('2026-01', 3)
    months[1] = {
      ...months[1]!,
      accounts: {
        ...months[1]!.accounts,
        ORDINARY_DEPOSIT: { ...months[1]!.accounts.ORDINARY_DEPOSIT, closingBalance: 1 },
      },
    }

    expect(
      validateCashFlowUpload({ closedThrough: '2026-03-31', openingBalances: OPENING_BALANCES, months }, period, today),
    ).toEqual({ reason: 'CASH_BALANCE_MISMATCH', field: 'months[1].accounts.ORDINARY_DEPOSIT.closingBalance' })
  })

  it('유입이나 유출이 음수면 거절합니다', () => {
    const months = cashFlowMonths('2026-01', 1)
    months[0] = {
      ...months[0]!,
      accounts: { ...months[0]!.accounts, CASH: { inflow: -100_000, outflow: 0, closingBalance: 900_000 } },
    }

    expect(
      validateCashFlowUpload({ closedThrough: '2026-01-31', openingBalances: OPENING_BALANCES, months }, period, today),
    ).toEqual({ reason: 'CASH_AMOUNT_NEGATIVE', field: 'months[0].accounts.CASH.inflow' })
  })

  it('당좌차월로 잔액이 음수인 것은 받습니다', () => {
    const months = cashFlowMonths('2026-01', 1)
    months[0] = {
      ...months[0]!,
      accounts: { ...months[0]!.accounts, CHECKING_DEPOSIT: { inflow: 0, outflow: 300_000, closingBalance: -300_000 } },
    }

    expect(
      validateCashFlowUpload({ closedThrough: '2026-01-31', openingBalances: OPENING_BALANCES, months }, period, today),
    ).toBeUndefined()
  })
})

describe('자금 흐름 계정 합계', () => {
  it('유입·유출·순유입·보유자금을 네 계정으로 합칩니다', () => {
    const month = deriveCashFlowMonth(cashFlowMonths('2026-01', 1)[0]!)

    expect(month).toMatchObject({
      inflow: 20_000_000,
      outflow: 15_100_000,
      netInflow: 4_900_000,
      fundsHeld: 900_000 + 55_000_000,
    })
  })
})
