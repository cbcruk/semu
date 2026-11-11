import { describe, expect, it } from 'vitest'
import { ledgerWithBalances, summarizeLedgers, validateReceivablePayableUpload } from './receivable-payable-rules.ts'
import { partnerLedgers } from './settlement.testing.ts'
import { fiscalPeriod } from './settlement-rules.ts'

const period = fiscalPeriod(2026, 12)
const today = '2026-11-11'

describe('미수·미지급 업로드 검증', () => {
  it('거래처와 거래가 맞으면 통과합니다', () => {
    expect(
      validateReceivablePayableUpload({ closedThrough: '2026-03-31', ...partnerLedgers(2026) }, period, today),
    ).toBeUndefined()
  })

  it('결산 기준일은 다른 보고서와 같은 규칙으로 봅니다', () => {
    expect(
      validateReceivablePayableUpload({ closedThrough: '2026-03-30', ...partnerLedgers(2026) }, period, today),
    ).toEqual({ reason: 'CLOSED_THROUGH_NOT_MONTH_END', field: 'closedThrough' })
  })

  it('결산 기준일 뒤의 거래는 거절합니다', () => {
    expect(
      validateReceivablePayableUpload({ closedThrough: '2026-02-28', ...partnerLedgers(2026) }, period, today),
    ).toEqual({ reason: 'ENTRY_DATE_OUT_OF_RANGE', field: 'receivables[1].entries[0].date' })
  })

  it('사업연도 앞의 거래는 거절합니다', () => {
    const ledgers = partnerLedgers(2026)
    ledgers.payables[0] = {
      ...ledgers.payables[0]!,
      entries: [{ date: '2025-12-31', summary: null, increase: 1, decrease: 0 }],
    }

    expect(validateReceivablePayableUpload({ closedThrough: '2026-03-31', ...ledgers }, period, today)).toEqual({
      reason: 'ENTRY_DATE_OUT_OF_RANGE',
      field: 'payables[0].entries[0].date',
    })
  })

  it('같은 쪽에서 거래처 코드가 겹치면 거절합니다', () => {
    const ledgers = partnerLedgers(2026)
    ledgers.receivables[1] = { ...ledgers.receivables[1]!, partnerCode: ' A001 ' }

    expect(validateReceivablePayableUpload({ closedThrough: '2026-03-31', ...ledgers }, period, today)).toEqual({
      reason: 'PARTNER_DUPLICATED',
      field: 'receivables[1].partnerCode',
    })
  })

  it('같은 거래처가 미수와 미지급에 함께 있는 것은 받습니다', () => {
    const ledgers = partnerLedgers(2026)
    ledgers.payables[0] = { ...ledgers.payables[0]!, partnerCode: 'A001' }

    expect(validateReceivablePayableUpload({ closedThrough: '2026-03-31', ...ledgers }, period, today)).toBeUndefined()
  })

  it('거래처 이름이 비어 있으면 거절합니다', () => {
    const ledgers = partnerLedgers(2026)
    ledgers.payables[0] = { ...ledgers.payables[0]!, partnerName: ' ' }

    expect(validateReceivablePayableUpload({ closedThrough: '2026-03-31', ...ledgers }, period, today)).toEqual({
      reason: 'PARTNER_BLANK',
      field: 'payables[0].partnerName',
    })
  })

  it('증가나 감소가 음수면 거절합니다', () => {
    const ledgers = partnerLedgers(2026)
    ledgers.payables[0] = {
      ...ledgers.payables[0]!,
      entries: [{ date: '2026-01-25', summary: null, increase: 0, decrease: -1 }],
    }

    expect(validateReceivablePayableUpload({ closedThrough: '2026-03-31', ...ledgers }, period, today)).toEqual({
      reason: 'ENTRY_AMOUNT_NEGATIVE',
      field: 'payables[0].entries[0].decrease',
    })
  })
})

describe('미수·미지급 집계', () => {
  const side = summarizeLedgers(partnerLedgers(2026).receivables, period, '2026-04-30')

  it('전체 기초·증가·감소·기말을 거래에서 냅니다', () => {
    expect(side).toMatchObject({
      openingBalance: 3_000_000,
      increase: 7_000_000,
      decrease: 4_000_000,
      closingBalance: 6_000_000,
    })
  })

  it('달마다 전월 기말을 이어 받고, 거래 없는 달도 냅니다', () => {
    expect(side.months).toEqual([
      { month: '2026-01', openingBalance: 3_000_000, increase: 5_000_000, decrease: 0, closingBalance: 8_000_000 },
      { month: '2026-02', openingBalance: 8_000_000, increase: 0, decrease: 4_000_000, closingBalance: 4_000_000 },
      { month: '2026-03', openingBalance: 4_000_000, increase: 2_000_000, decrease: 0, closingBalance: 6_000_000 },
      { month: '2026-04', openingBalance: 6_000_000, increase: 0, decrease: 0, closingBalance: 6_000_000 },
    ])
  })

  it('거래처 기말 잔액의 합은 전체 기말 잔액과 같습니다', () => {
    expect(side.partners).toEqual([
      {
        partnerCode: 'A001',
        partnerName: '가나상사',
        entryCount: 2,
        openingBalance: 3_000_000,
        increase: 5_000_000,
        decrease: 4_000_000,
        closingBalance: 4_000_000,
      },
      {
        partnerCode: 'A002',
        partnerName: '다라유통',
        entryCount: 1,
        openingBalance: 0,
        increase: 2_000_000,
        decrease: 0,
        closingBalance: 2_000_000,
      },
    ])
    expect(side.partners.reduce((sum, partner) => sum + partner.closingBalance, 0)).toBe(side.closingBalance)
  })
})

describe('거래처 원장 누적 잔액', () => {
  it('날짜 순으로 정렬해 거래마다 잔액을 붙입니다', () => {
    expect(
      ledgerWithBalances(partnerLedgers(2026).receivables[0]!).map((entry) => [entry.date, entry.balance]),
    ).toEqual([
      ['2026-01-15', 8_000_000],
      ['2026-02-10', 4_000_000],
    ])
  })
})
