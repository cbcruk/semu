import { describe, expect, it } from 'vitest'
import { profitLossMonth, profitLossMonths } from './settlement.testing.ts'
import {
  deriveProfitLossMonth,
  fiscalPeriod,
  PROFIT_LOSS_SECTIONS,
  sumProfitLoss,
  validateProfitLossUpload,
} from './settlement-rules.ts'

describe('사업연도 기간', () => {
  it('12월 결산은 1월 1일부터 12월 31일까지입니다', () => {
    expect(fiscalPeriod(2026, 12)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('3월 결산은 끝나는 해의 전년 4월 1일부터입니다', () => {
    expect(fiscalPeriod(2026, 3)).toEqual({ start: '2025-04-01', end: '2026-03-31' })
  })

  it('2월 결산은 그해 2월 말일로 끝납니다', () => {
    expect(fiscalPeriod(2028, 2)).toEqual({ start: '2027-03-01', end: '2028-02-29' })
  })
})

describe('손익 스냅샷 업로드 검증', () => {
  const 기간 = fiscalPeriod(2026, 12)
  const 오늘 = '2026-11-11'

  it('첫 달부터 결산 기준일이 속한 달까지 빠짐없으면 통과합니다', () => {
    const upload = { closedThrough: '2026-10-31', months: profitLossMonths('2026-01', 10) }

    expect(validateProfitLossUpload(upload, 기간, 오늘)).toBeUndefined()
  })

  it('결산 기준일이 사업연도 밖이면 거절합니다', () => {
    const upload = { closedThrough: '2025-12-31', months: [] }

    expect(validateProfitLossUpload(upload, 기간, 오늘)).toEqual({
      reason: 'CLOSED_THROUGH_OUT_OF_PERIOD',
      field: 'closedThrough',
    })
  })

  it('결산 기준일이 오늘보다 늦으면 거절합니다', () => {
    const upload = { closedThrough: '2026-11-30', months: profitLossMonths('2026-01', 11) }

    expect(validateProfitLossUpload(upload, 기간, 오늘)).toEqual({
      reason: 'CLOSED_THROUGH_IN_FUTURE',
      field: 'closedThrough',
    })
  })

  it('결산 기준일 뒤의 달이 있으면 거절합니다', () => {
    const upload = { closedThrough: '2026-02-28', months: profitLossMonths('2026-01', 3) }

    expect(validateProfitLossUpload(upload, 기간, 오늘)).toEqual({
      reason: 'MONTH_OUT_OF_RANGE',
      field: 'months[2].month',
    })
  })

  it('사업연도 앞의 달이 있으면 거절합니다', () => {
    const upload = { closedThrough: '2026-01-31', months: [profitLossMonth('2025-12'), profitLossMonth('2026-01')] }

    expect(validateProfitLossUpload(upload, 기간, 오늘)).toEqual({
      reason: 'MONTH_OUT_OF_RANGE',
      field: 'months[0].month',
    })
  })

  it('같은 달이 두 번 있으면 거절합니다', () => {
    const upload = { closedThrough: '2026-01-31', months: [profitLossMonth('2026-01'), profitLossMonth('2026-01')] }

    expect(validateProfitLossUpload(upload, 기간, 오늘)).toEqual({
      reason: 'MONTH_DUPLICATED',
      field: 'months[1].month',
    })
  })

  it('중간 달이 빠지면 거절합니다', () => {
    const upload = { closedThrough: '2026-03-31', months: [profitLossMonth('2026-01'), profitLossMonth('2026-03')] }

    expect(validateProfitLossUpload(upload, 기간, 오늘)).toEqual({ reason: 'MONTH_MISSING', field: 'months' })
  })

  it('3월 결산 법인은 전년 4월부터 보냅니다', () => {
    const upload = { closedThrough: '2025-06-30', months: profitLossMonths('2025-04', 3) }

    expect(validateProfitLossUpload(upload, fiscalPeriod(2026, 3), 오늘)).toBeUndefined()
  })

  it('계정 이름이 비어 있으면 거절합니다', () => {
    const month = profitLossMonth('2026-01', {
      REVENUE: { amount: 10, accounts: [{ name: '  ', amount: 10 }] },
    })

    expect(validateProfitLossUpload({ closedThrough: '2026-01-31', months: [month] }, 기간, 오늘)).toEqual({
      reason: 'ACCOUNT_NAME_BLANK',
      field: 'months[0].sections.REVENUE.accounts[0].name',
    })
  })

  it('섹션 안에서 계정 이름이 겹치면 거절합니다', () => {
    const month = profitLossMonth('2026-01', {
      REVENUE: {
        amount: 20,
        accounts: [
          { name: '상품매출', amount: 10 },
          { name: '상품매출 ', amount: 10 },
        ],
      },
    })

    expect(validateProfitLossUpload({ closedThrough: '2026-01-31', months: [month] }, 기간, 오늘)).toEqual({
      reason: 'ACCOUNT_DUPLICATED',
      field: 'months[0].sections.REVENUE.accounts[1].name',
    })
  })

  it('계정 합이 섹션 합계와 다르면 거절합니다', () => {
    const month = profitLossMonth('2026-01', {
      COST_OF_SALES: {
        amount: 400,
        accounts: [
          { name: '기초제품재고액', amount: 100 },
          { name: '당기제품제조원가', amount: 500 },
          { name: '기말제품재고액', amount: 200 },
        ],
      },
    })

    expect(validateProfitLossUpload({ closedThrough: '2026-01-31', months: [month] }, 기간, 오늘)).toEqual({
      reason: 'SECTION_TOTAL_MISMATCH',
      field: 'months[0].sections.COST_OF_SALES.amount',
    })
  })

  it('줄이는 계정을 음수로 적으면 섹션 합계와 맞습니다', () => {
    const month = profitLossMonth('2026-01', {
      COST_OF_SALES: {
        amount: 400,
        accounts: [
          { name: '기초제품재고액', amount: 100 },
          { name: '당기제품제조원가', amount: 500 },
          { name: '기말제품재고액', amount: -200 },
        ],
      },
    })

    expect(validateProfitLossUpload({ closedThrough: '2026-01-31', months: [month] }, 기간, 오늘)).toBeUndefined()
  })
})

describe('손익 계산 섹션', () => {
  it('매출총이익·영업이익·당기순이익을 채웁니다', () => {
    const month = deriveProfitLossMonth(profitLossMonth('2026-01'))

    expect(month.sections.GROSS_PROFIT).toEqual({ amount: 6_000_000, accounts: [] })
    expect(month.sections.OPERATING_INCOME).toEqual({ amount: 3_000_000, accounts: [] })
    expect(month.sections.NET_INCOME).toEqual({ amount: 2_600_000, accounts: [] })
  })

  it('당기 누계는 섹션과 계정을 이름으로 더합니다', () => {
    const months = [
      deriveProfitLossMonth(profitLossMonth('2026-01')),
      deriveProfitLossMonth(
        profitLossMonth('2026-02', {
          REVENUE: {
            amount: 3_000_000,
            accounts: [
              { name: '용역매출', amount: 1_000_000 },
              { name: '상품매출', amount: 2_000_000 },
            ],
          },
        }),
      ),
    ]

    const total = sumProfitLoss(months)

    expect(Object.keys(total)).toEqual(PROFIT_LOSS_SECTIONS)
    expect(total.REVENUE).toEqual({
      amount: 13_000_000,
      accounts: [
        { name: '상품매출', amount: 12_000_000 },
        { name: '용역매출', amount: 1_000_000 },
      ],
    })
    expect(total.NET_INCOME.amount).toBe(2_600_000 + (2_600_000 - 7_000_000))
  })
})
