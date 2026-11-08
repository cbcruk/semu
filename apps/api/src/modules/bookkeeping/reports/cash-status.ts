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
  const 시작전날 = addDays(input.start, -1)
  const 시작잔액 = input.snapshotsByAccount.reduce((sum, snapshots) => sum + closingBalanceOn(snapshots, 시작전날), 0)
  const 마감잔액 = input.snapshotsByAccount.reduce((sum, snapshots) => sum + closingBalanceOn(snapshots, input.end), 0)
  const 입금합 = input.transactions.reduce((sum, row) => sum + Math.max(row.amount, 0), 0)
  const 출금합 = input.transactions.reduce((sum, row) => sum + Math.min(row.amount, 0), 0)
  return {
    openingAmount: 시작잔액,
    depositAmount: 입금합,
    withdrawalAmount: 출금합,
    otherChangeAmount: 마감잔액 - 시작잔액 - 입금합 - 출금합,
    closingAmount: 마감잔액,
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
  const 방향계정과목별묶음 = new Map<
    string,
    { direction: Direction; key: string; name: string; amount: number; count: number }
  >()
  for (const row of transactions) {
    const 계정과목 = row.accountTitleId === null ? undefined : titles.get(row.accountTitleId)
    const 계정과목키 = 계정과목 === undefined || row.accountTitleId === null ? 'UNCLASSIFIED' : row.accountTitleId
    const 묶음키 = `${row.direction}:${계정과목키}`
    const 묶음 = 방향계정과목별묶음.get(묶음키) ?? {
      direction: row.direction,
      key: 계정과목키,
      name: 계정과목?.name ?? UNCLASSIFIED_LABEL[row.direction],
      amount: 0,
      count: 0,
    }
    묶음.amount += row.amount
    묶음.count++
    방향계정과목별묶음.set(묶음키, 묶음)
  }
  return [...방향계정과목별묶음.values()].sort((a, b) =>
    a.direction === b.direction ? 0 : a.direction === 'DEPOSIT' ? -1 : 1,
  )
}

/**
 * 한 방향 거래를 자금 카테고리별로 더합니다(기간별 추이). 카테고리는 계정과목의 `cashCategory`, 없으면 보고서 줄 이름입니다.
 */
export function sumByCashCategory(
  transactions: ReadonlyArray<CashTransaction>,
  direction: Direction,
  titles: ReadonlyMap<string, Pick<AccountTitleInfo, 'cashCategory' | 'reportName'>>,
): Array<{ category: string; amount: number }> {
  const 자금카테고리별합 = new Map<string, number>()
  for (const row of transactions) {
    if (row.direction !== direction) continue
    const 계정과목 = row.accountTitleId === null ? undefined : titles.get(row.accountTitleId)
    const 자금카테고리 =
      계정과목 === undefined ? UNCLASSIFIED_LABEL[direction] : (계정과목.cashCategory ?? 계정과목.reportName)
    자금카테고리별합.set(자금카테고리, (자금카테고리별합.get(자금카테고리) ?? 0) + row.amount)
  }
  return [...자금카테고리별합.entries()].map(([category, amount]) => ({ category, amount }))
}
