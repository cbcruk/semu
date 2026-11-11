import { describe, expect, it } from 'vitest'
import {
  cumulativeProfitLoss,
  deriveBalanceSheetMonth,
  ratioPpm,
  validateBalanceSheetUpload,
} from './balance-sheet-rules.ts'
import { balanceSheetMonth, balanceSheetMonths, profitLossMonths } from './settlement.testing.ts'
import { deriveProfitLossMonth, fiscalPeriod } from './settlement-rules.ts'

const period = fiscalPeriod(2026, 12)
const today = '2026-11-11'

describe('재무상태표 업로드 검증', () => {
  it('자산 = 부채 + 자본이면 통과합니다', () => {
    const upload = { closedThrough: '2026-10-31', months: balanceSheetMonths('2026-01', 10) }

    expect(validateBalanceSheetUpload(upload, period, today)).toBeUndefined()
  })

  it('결산 기준일과 월 목록은 다른 보고서와 같은 규칙으로 봅니다', () => {
    const upload = { closedThrough: '2026-10-15', months: balanceSheetMonths('2026-01', 10) }

    expect(validateBalanceSheetUpload(upload, period, today)).toEqual({
      reason: 'CLOSED_THROUGH_NOT_MONTH_END',
      field: 'closedThrough',
    })
  })

  it('자산과 부채·자본의 합이 다르면 그 달을 가리킵니다', () => {
    const months = balanceSheetMonths('2026-01', 2)
    months[1] = balanceSheetMonth('2026-02', {
      groups: { ...months[1]!.groups, NON_CURRENT_ASSETS: { amount: 50_000_001, accounts: [] } },
    })

    expect(validateBalanceSheetUpload({ closedThrough: '2026-02-28', months }, period, today)).toEqual({
      reason: 'BALANCE_SHEET_UNBALANCED',
      field: 'months[1]',
    })
  })

  it('구분의 계정 합이 구분 금액과 다르면 거절합니다', () => {
    const base = balanceSheetMonth('2026-01')
    const month = balanceSheetMonth('2026-01', {
      groups: { ...base.groups, CURRENT_ASSETS: { amount: 50_000_000, accounts: [{ name: '현금', amount: 1 }] } },
    })

    expect(validateBalanceSheetUpload({ closedThrough: '2026-01-31', months: [month] }, period, today)).toEqual({
      reason: 'SECTION_TOTAL_MISMATCH',
      field: 'months[0].groups.CURRENT_ASSETS.amount',
    })
  })

  it('자본잠식으로 자본이 음수여도 등식이 맞으면 받습니다', () => {
    const base = balanceSheetMonth('2026-01')
    const month = balanceSheetMonth('2026-01', {
      groups: {
        ...base.groups,
        CURRENT_LIABILITIES: { amount: 85_000_000, accounts: [] },
        NON_CURRENT_LIABILITIES: { amount: 25_000_000, accounts: [] },
        RETAINED_EARNINGS: { amount: -60_000_000, accounts: [] },
      },
    })

    expect(validateBalanceSheetUpload({ closedThrough: '2026-01-31', months: [month] }, period, today)).toBeUndefined()
  })

  it('재고자산과 매출채권의 합이 유동자산을 넘으면 거절합니다', () => {
    const month = balanceSheetMonth('2026-01', { inventories: 30_000_001, tradeReceivables: 20_000_000 })

    expect(validateBalanceSheetUpload({ closedThrough: '2026-01-31', months: [month] }, period, today)).toEqual({
      reason: 'CURRENT_ASSET_COMPONENT_INVALID',
      field: 'months[0]',
    })
  })

  it('재고자산이 음수면 거절합니다', () => {
    const month = balanceSheetMonth('2026-01', { inventories: -1 })

    expect(validateBalanceSheetUpload({ closedThrough: '2026-01-31', months: [month] }, period, today)).toEqual({
      reason: 'CURRENT_ASSET_COMPONENT_INVALID',
      field: 'months[0]',
    })
  })
})

describe('비율 ppm', () => {
  it('0에서 먼 쪽으로 반올림합니다', () => {
    expect(ratioPpm(1, 3)).toBe(333_333)
    expect(ratioPpm(2, 3)).toBe(666_667)
    expect(ratioPpm(-1, 8)).toBe(-125_000)
    expect(ratioPpm(1, -2_000_000)).toBe(-1)
  })

  it('분모가 0이면 null입니다', () => {
    expect(ratioPpm(5, 0)).toBeNull()
  })

  it('1조 원대 금액도 정확히 셉니다', () => {
    expect(ratioPpm(3_000_000_000_000, 7_000_000_000_000)).toBe(428_571)
  })
})

describe('재무상태표 총계와 비율', () => {
  it('손익 누계가 있으면 여덟 비율을 모두 채웁니다', () => {
    const cumulative = cumulativeProfitLoss(profitLossMonths('2026-01', 3).map(deriveProfitLossMonth))

    const month = deriveBalanceSheetMonth(balanceSheetMonth('2026-03'), cumulative.get('2026-03'))

    expect(cumulative.get('2026-03')).toEqual({ revenue: 30_000_000, netIncome: 7_800_000 })
    expect(month.totals).toEqual({
      assets: 100_000_000,
      liabilities: 40_000_000,
      equity: 60_000_000,
      liabilitiesAndEquity: 100_000_000,
    })
    expect(month.ratios).toEqual({
      equityRatioPpm: 600_000,
      debtRatioPpm: 666_667,
      currentRatioPpm: 2_000_000,
      returnOnAssetsPpm: 78_000,
      returnOnEquityPpm: 130_000,
      totalAssetTurnoverPpm: 300_000,
      inventoryTurnoverPpm: 3_000_000,
      receivablesTurnoverPpm: 1_500_000,
    })
  })

  it('그 달 손익이 없으면 손익을 쓰는 비율만 null입니다', () => {
    const month = deriveBalanceSheetMonth(balanceSheetMonth('2026-03'), undefined)

    expect(month.ratios).toMatchObject({
      equityRatioPpm: 600_000,
      returnOnAssetsPpm: null,
      returnOnEquityPpm: null,
      totalAssetTurnoverPpm: null,
      inventoryTurnoverPpm: null,
      receivablesTurnoverPpm: null,
    })
  })

  it('재고자산이 0이면 재고자산회전율은 null입니다', () => {
    const cumulative = { revenue: 10_000_000, netIncome: 1 }

    const month = deriveBalanceSheetMonth(balanceSheetMonth('2026-01', { inventories: 0 }), cumulative)

    expect(month.ratios.inventoryTurnoverPpm).toBeNull()
  })
})
