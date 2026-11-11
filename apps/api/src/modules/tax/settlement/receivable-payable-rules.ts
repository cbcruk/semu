import { addMonths } from '../../../shared/time/calendar.ts'
import type {
  BalanceMovement,
  FiscalPeriod,
  PartnerLedger,
  PartnerLedgerEntry,
  ReceivablePayableSide,
  ReceivablePayableUpload,
  SettlementSnapshotViolation,
} from './settlement-report.types.ts'
import { validateClosedThrough } from './settlement-rules.ts'

/**
 * 미수·미지급 스냅샷 업로드가 맞는지 봅니다. 맞으면 `undefined`, 아니면 처음 걸린 위반 하나입니다.
 *
 * - 결산 기준일은 {@link validateClosedThrough}가 봅니다
 * - 거래처 코드는 `.`·`..`일 수 없습니다. 원장 경로(`.../{partnerCode}`)에서 URL 정규화가 이 값을 지워 다른 경로가 됩니다
 * - 거래처 코드와 이름은 비어 있지 않고, 코드는 미수·미지급 각각 안에서 겹치지 않습니다. 같은 거래처가 미수와 미지급에 함께 있을 수는 있습니다
 * - 거래 날짜는 사업연도 시작일부터 결산 기준일까지입니다
 * - 증가와 감소는 0 이상입니다. 방향은 필드가 정하므로 부호를 쓰지 않습니다
 *
 * 잔액의 부호는 보지 않습니다. 선수금을 받거나 더 많이 갚으면 잔액이 음수일 수 있습니다.
 */
export function validateReceivablePayableUpload(
  upload: ReceivablePayableUpload,
  period: FiscalPeriod,
  today: string,
): SettlementSnapshotViolation | undefined {
  const closedThroughViolation = validateClosedThrough(upload.closedThrough, period, today)
  if (closedThroughViolation !== undefined) return closedThroughViolation

  for (const [side, ledgers] of [
    ['receivables', upload.receivables],
    ['payables', upload.payables],
  ] as const) {
    const 코드들 = new Set<string>()
    for (const [index, ledger] of ledgers.entries()) {
      const field = `${side}[${index}]`
      const 코드 = ledger.partnerCode.trim()
      if (코드 === '') return { reason: 'PARTNER_BLANK', field: `${field}.partnerCode` }
      if (ledger.partnerName.trim() === '') return { reason: 'PARTNER_BLANK', field: `${field}.partnerName` }
      if (코드 === '.' || 코드 === '..') return { reason: 'PARTNER_CODE_RESERVED', field: `${field}.partnerCode` }
      if (코드들.has(코드)) return { reason: 'PARTNER_DUPLICATED', field: `${field}.partnerCode` }
      코드들.add(코드)
      for (const [entryIndex, entry] of ledger.entries.entries()) {
        const entryField = `${field}.entries[${entryIndex}]`
        if (entry.date < period.start || entry.date > upload.closedThrough) {
          return { reason: 'ENTRY_DATE_OUT_OF_RANGE', field: `${entryField}.date` }
        }
        if (entry.increase < 0) return { reason: 'ENTRY_AMOUNT_NEGATIVE', field: `${entryField}.increase` }
        if (entry.decrease < 0) return { reason: 'ENTRY_AMOUNT_NEGATIVE', field: `${entryField}.decrease` }
      }
    }
  }
  return undefined
}

/** 거래를 날짜 순으로 둡니다. 같은 날은 올린 순서를 지킵니다. */
function sortedEntries(entries: ReadonlyArray<PartnerLedgerEntry>): PartnerLedgerEntry[] {
  return entries.toSorted((a, b) => a.date.localeCompare(b.date))
}

function 움직임(openingBalance: number, entries: ReadonlyArray<PartnerLedgerEntry>): BalanceMovement {
  const increase = entries.reduce((sum, entry) => sum + entry.increase, 0)
  const decrease = entries.reduce((sum, entry) => sum + entry.decrease, 0)
  return { openingBalance, increase, decrease, closingBalance: openingBalance + increase - decrease }
}

/**
 * 거래처 원장으로 미수 또는 미지급 한쪽을 집계합니다. 모든 숫자를 거래에서 계산하므로 월별 합계, 거래처별 합계, 원장 잔액이 서로 어긋나지 않습니다.
 *
 * ```text
 * 기말 잔액 = 기초 잔액 + 증가 − 감소           (거래처·달·전체 모두)
 * 달의 기초 잔액 = 전월 기말 잔액(첫 달은 거래처 기초 잔액의 합)
 * Σ 거래처 기말 잔액 = 마지막 달 기말 잔액 = 전체 기말 잔액
 * ```
 *
 * 달은 사업연도 첫 달부터 결산 기준일이 속한 달까지 거래가 없는 달도 모두 냅니다. 거래처는 올린 순서입니다.
 */
export function summarizeLedgers(
  ledgers: ReadonlyArray<PartnerLedger>,
  period: FiscalPeriod,
  closedThrough: string,
): ReceivablePayableSide {
  const partners = ledgers.map((ledger) => ({
    partnerCode: ledger.partnerCode.trim(),
    partnerName: ledger.partnerName.trim(),
    entryCount: ledger.entries.length,
    ...움직임(ledger.openingBalance, ledger.entries),
  }))
  const 전체기초 = ledgers.reduce((sum, ledger) => sum + ledger.openingBalance, 0)
  const 모든거래 = ledgers.flatMap((ledger) => ledger.entries)

  const months: Array<BalanceMovement & { month: string }> = []
  let 기초 = 전체기초
  for (let month = period.start.slice(0, 7); month <= closedThrough.slice(0, 7); month = addMonths(month, 1)) {
    const 이달 = 움직임(
      기초,
      모든거래.filter((entry) => entry.date.startsWith(month)),
    )
    months.push({ month, ...이달 })
    기초 = 이달.closingBalance
  }
  return { ...움직임(전체기초, 모든거래), months, partners }
}

/** 거래처 원장에 거래마다 누적 잔액을 채웁니다. 날짜 순이고, 마지막 거래의 잔액이 거래처 기말 잔액입니다. */
export function ledgerWithBalances(ledger: PartnerLedger): Array<PartnerLedgerEntry & { balance: number }> {
  let balance = ledger.openingBalance
  return sortedEntries(ledger.entries).map((entry) => {
    balance += entry.increase - entry.decrease
    return { ...entry, balance }
  })
}
