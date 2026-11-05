import { addDays } from '../../../shared/time/calendar.ts'
import type { AccountTitleInfo } from '../account-titles/account-title.types.ts'
import { closingBalanceOn } from '../bank/balance-snapshot.ts'
import type { BalanceSnapshotRecord, Direction } from '../bank/bank.types.ts'

/** 기간의 시작 잔액·입출금·마감 잔액입니다. 출금은 음수입니다. */
export interface CashFlowFigures {
  openingAmount: number
  depositAmount: number
  withdrawalAmount: number
  /** 마감 − 시작 − 입금 − 출금입니다. 이자 결산·수집 누락·외화 환산 차이를 보여 줍니다. */
  otherChangeAmount: number
  closingAmount: number
}

/** 자금 집계에 쓰는 거래 한 건입니다. */
export interface CashTransaction {
  bankAccountId: string
  date: string
  direction: Direction
  amount: number
  accountTitleId: string | null
}

/**
 * 계좌 묶음의 기간 자금 흐름입니다.
 *
 * 시작 잔액은 시작일 전날 마감 잔액 합계, 마감 잔액은 종료일 마감 잔액 합계입니다. 스냅샷이 없는 날은 직전 스냅샷을
 * 이어 씁니다. 입금은 양수 금액, 출금은 음수 금액의 합계입니다.
 */
export function cashFlowFigures(input: {
  snapshotsByAccount: ReadonlyArray<ReadonlyArray<Pick<BalanceSnapshotRecord, 'date' | 'closingBalance'>>>
  transactions: ReadonlyArray<Pick<CashTransaction, 'amount'>>
  start: string
  end: string
}): CashFlowFigures {
  const dayBefore = addDays(input.start, -1)
  const openingAmount = input.snapshotsByAccount.reduce(
    (sum, snapshots) => sum + closingBalanceOn(snapshots, dayBefore),
    0,
  )
  const closingAmount = input.snapshotsByAccount.reduce(
    (sum, snapshots) => sum + closingBalanceOn(snapshots, input.end),
    0,
  )
  const depositAmount = input.transactions.reduce((sum, row) => sum + Math.max(row.amount, 0), 0)
  const withdrawalAmount = input.transactions.reduce((sum, row) => sum + Math.min(row.amount, 0), 0)
  return {
    openingAmount,
    depositAmount,
    withdrawalAmount,
    otherChangeAmount: closingAmount - openingAmount - depositAmount - withdrawalAmount,
    closingAmount,
  }
}

/** 미분류 거래를 묶는 이름입니다. */
export const UNCLASSIFIED_LABEL: Record<Direction, string> = { DEPOSIT: '미분류 입금', WITHDRAWAL: '미분류 출금' }

/**
 * 입금·출금을 계정과목별로 묶습니다(일별 자금 `분류별`). 미분류는 방향별 한 묶음입니다.
 *
 * `key`는 계정과목 ID 또는 `UNCLASSIFIED`입니다.
 */
export function groupByAccountTitle(
  transactions: ReadonlyArray<CashTransaction>,
  titles: ReadonlyMap<string, Pick<AccountTitleInfo, 'name'>>,
): Array<{ direction: Direction; key: string; name: string; amount: number; count: number }> {
  const groups = new Map<string, { direction: Direction; key: string; name: string; amount: number; count: number }>()
  for (const row of transactions) {
    const info = row.accountTitleId === null ? undefined : titles.get(row.accountTitleId)
    const key = info === undefined || row.accountTitleId === null ? 'UNCLASSIFIED' : row.accountTitleId
    const id = `${row.direction}:${key}`
    const entry = groups.get(id) ?? {
      direction: row.direction,
      key,
      name: info?.name ?? UNCLASSIFIED_LABEL[row.direction],
      amount: 0,
      count: 0,
    }
    entry.amount += row.amount
    entry.count++
    groups.set(id, entry)
  }
  return [...groups.values()].sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'DEPOSIT' ? -1 : 1))
}

/**
 * 한 방향 거래를 자금 카테고리별로 더합니다(기간별 추이). 카테고리는 계정과목의 `cashCategory`, 없으면 보고서 줄 이름입니다.
 */
export function sumByCashCategory(
  transactions: ReadonlyArray<CashTransaction>,
  direction: Direction,
  titles: ReadonlyMap<string, Pick<AccountTitleInfo, 'cashCategory' | 'reportName'>>,
): Array<{ category: string; amount: number }> {
  const sums = new Map<string, number>()
  for (const row of transactions) {
    if (row.direction !== direction) continue
    const info = row.accountTitleId === null ? undefined : titles.get(row.accountTitleId)
    const label = info === undefined ? UNCLASSIFIED_LABEL[direction] : (info.cashCategory ?? info.reportName)
    sums.set(label, (sums.get(label) ?? 0) + row.amount)
  }
  return [...sums.entries()].map(([category, amount]) => ({ category, amount }))
}
