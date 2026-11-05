import type { BalanceSnapshotRecord, BankAccountRecord, BankAccountTypeCode } from './bank.types.ts'

/**
 * 같은 계좌·날짜에 잔액 스냅샷이 둘 들어올 때 남길 쪽입니다.
 *
 * 은행이 준 마감 잔액(`SCRAPED`)이 거래 후 잔액으로 만든 값(`DERIVED`)보다 우선합니다. 같은 출처끼리는 새 값이 이깁니다.
 */
export function mergeSnapshot(
  current: Pick<BalanceSnapshotRecord, 'source'> | undefined,
  incoming: Pick<BalanceSnapshotRecord, 'source'>,
): 'KEEP' | 'REPLACE' {
  if (current === undefined) return 'REPLACE'
  return incoming.source === 'SCRAPED' || current.source === 'DERIVED' ? 'REPLACE' : 'KEEP'
}

/** 날짜의 마감 잔액입니다. 그날 이전 가장 최근 스냅샷을 이어 쓰고, 첫 스냅샷 전이면 0입니다. */
export function closingBalanceOn(
  snapshots: ReadonlyArray<Pick<BalanceSnapshotRecord, 'date' | 'closingBalance'>>,
  date: string,
): number {
  let best: Pick<BalanceSnapshotRecord, 'date' | 'closingBalance'> | undefined
  for (const snapshot of snapshots) {
    if (snapshot.date <= date && (best === undefined || snapshot.date > best.date)) best = snapshot
  }
  return best?.closingBalance ?? 0
}

/**
 * 거래 후 잔액으로 하루 마감 잔액을 만듭니다. 그날 마지막 거래(시각, 같으면 수집 키 역순 첫 번째)의 거래 후 잔액입니다.
 * 거래 후 잔액이 있는 거래가 없으면 `undefined`입니다.
 */
export function derivedClosing(
  transactions: ReadonlyArray<{ transactedAt: string; externalKey: string; balanceAfter: number | null }>,
): number | undefined {
  const withBalance = transactions.filter((row) => row.balanceAfter !== null)
  withBalance.sort((a, b) =>
    a.transactedAt === b.transactedAt
      ? b.externalKey.localeCompare(a.externalKey)
      : b.transactedAt.localeCompare(a.transactedAt),
  )
  return withBalance[0]?.balanceAfter ?? undefined
}

/** 자금 현황에 넣는 계좌 종류입니다. 입출금(`01`)과 외화(`31`)입니다. */
export const CASH_ACCOUNT_TYPES: ReadonlyArray<BankAccountTypeCode> = ['01', '31']

/** 계좌 목록 요약의 자산 묶음입니다. */
export type AssetBucket = 'DEMAND' | 'FOREIGN_CURRENCY' | 'SAVINGS' | 'FUND' | 'TRUST' | 'INSURANCE' | 'PENSION'

const ASSET_BUCKET: Record<Exclude<BankAccountTypeCode, '41'>, AssetBucket> = {
  '01': 'DEMAND',
  '31': 'FOREIGN_CURRENCY',
  '02': 'SAVINGS',
  '21': 'FUND',
  '11': 'TRUST',
  '51': 'INSURANCE',
  '61': 'PENSION',
}

/** 계좌 목록 요약입니다. */
export interface BankAccountSummary {
  activeAccountCount: number
  totalAssetAmount: number
  assetAmountByBucket: Record<AssetBucket, number>
  totalLiabilityAmount: number
}

/** 활성 계좌로 총 자산·총 부채를 셉니다. 대출(`41`)은 잔액 절댓값을 부채로, 나머지는 자산으로 셉니다. */
export function summarizeBankAccounts(
  accounts: ReadonlyArray<Pick<BankAccountRecord, 'status' | 'accountTypeCode' | 'balance'>>,
): BankAccountSummary {
  const summary: BankAccountSummary = {
    activeAccountCount: 0,
    totalAssetAmount: 0,
    assetAmountByBucket: { DEMAND: 0, FOREIGN_CURRENCY: 0, SAVINGS: 0, FUND: 0, TRUST: 0, INSURANCE: 0, PENSION: 0 },
    totalLiabilityAmount: 0,
  }
  for (const account of accounts) {
    if (account.status === 'INACTIVE') continue
    summary.activeAccountCount++
    const balance = account.balance ?? 0
    if (account.accountTypeCode === '41') {
      summary.totalLiabilityAmount += Math.abs(balance)
      continue
    }
    summary.totalAssetAmount += balance
    summary.assetAmountByBucket[ASSET_BUCKET[account.accountTypeCode]] += balance
  }
  return summary
}
