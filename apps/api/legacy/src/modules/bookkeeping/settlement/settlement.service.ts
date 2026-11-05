import type { DatabaseSync } from 'node:sqlite'
import { invalidField } from '../../../lib/domain-error'
import {
  deleteScopeRows,
  insertBsLine,
  insertCashEntry,
  insertCashLedger,
  insertPartnerBalance,
  insertPartnerEntry,
  insertPlLine,
  upsertClosing,
} from './settlement.repository'
import type { BsLineInput, PlLineInput, PlLineRow, PlSection, SettlementClosingRow, SnapshotUpload } from './settlement.types'
import { PL_BASE_SECTIONS } from './settlement.utils'

/** Who uploads a snapshot and when. */
export interface UploadAuthor {
  userId: string
  now: string
}

/**
 * Replaces one scope of a company's settlement snapshot for a fiscal year.
 *
 * The caller owns the transaction, so the seed can reuse this inside its own.
 * Profit and loss uploads carry only the six base sections; 매출총이익,
 * 영업이익 and 당기순이익 are derived here. A base section without a `''` total
 * line gets the sum of its top-level accounts.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when rows fall outside the year, repeat a key or break an invariant.
 */
export function replaceSettlementSnapshot(
  db: DatabaseSync,
  companyId: string,
  year: number,
  upload: SnapshotUpload,
  author: UploadAuthor,
): SettlementClosingRow {
  if (!upload.closed_through.startsWith(`${year}-`)) throw invalidField('closed_through', `The closing date must fall in ${year}.`)
  deleteScopeRows(db, companyId, year, upload.scope)
  switch (upload.scope) {
    case 'pl':
      for (const line of derivePlLines(year, upload.lines)) insertPlLine(db, companyId, line)
      break
    case 'bs':
      for (const line of normalizeBsRows(year, upload.rows)) insertBsLine(db, companyId, line)
      break
    case 'cash': {
      assertUnique(upload.ledger.map((row) => `${row.month}:${row.cash_account}`), 'ledger')
      for (const row of upload.ledger) insertCashLedger(db, companyId, { year, ...row })
      upload.entries.forEach((entry, index) => {
        if (!entry.date.startsWith(`${year}-`)) throw invalidField(`entries.${index}.date`, `The date must fall in ${year}.`)
        insertCashEntry(db, companyId, year, { seq: index + 1, ...entry })
      })
      break
    }
    case 'ar_ap': {
      assertUnique(upload.balances.map((row) => `${row.kind}:${row.month}:${row.erp_partner_code}`), 'balances')
      const known = new Set<string>()
      upload.balances.forEach((row, index) => {
        if (row.balance !== row.rollover_balance + row.increase_amount - row.decrease_amount) {
          throw invalidField(`balances.${index}.balance`, 'The balance must equal rollover_balance + increase_amount - decrease_amount.')
        }
        known.add(`${row.kind}:${row.erp_partner_code}`)
        insertPartnerBalance(db, companyId, { year, ...row })
      })
      upload.entries.forEach((entry, index) => {
        if (!entry.date.startsWith(`${year}-`)) throw invalidField(`entries.${index}.date`, `The date must fall in ${year}.`)
        if (!known.has(`${entry.kind}:${entry.erp_partner_code}`)) throw invalidField(`entries.${index}.erp_partner_code`, 'Unknown partner code.')
        insertPartnerEntry(db, companyId, entry.kind, year, { seq: index + 1, ...entry })
      })
      break
    }
  }
  const closing: SettlementClosingRow = {
    company_id: companyId,
    fiscal_year: year,
    scope: upload.scope,
    closed_through: upload.closed_through,
    updated_at: author.now,
    updated_by: author.userId,
  }
  upsertClosing(db, closing)
  return closing
}

function derivePlLines(year: number, lines: readonly PlLineInput[]): PlLineRow[] {
  assertUnique(lines.map((line) => `${line.month}:${line.section}:${line.path}`), 'lines')
  const rows: PlLineRow[] = lines.map((line) => ({ year, ...line }))
  const months = [...new Set(lines.map((line) => line.month))].sort((a, b) => a - b)
  for (const month of months) {
    const total = (section: PlSection): number => {
      const ofSection = lines.filter((line) => line.month === month && line.section === section)
      const explicit = ofSection.find((line) => line.path === '')
      return explicit?.amount ?? ofSection.filter((line) => !line.path.includes('/')).reduce((sum, line) => sum + line.amount, 0)
    }
    const base = Object.fromEntries(PL_BASE_SECTIONS.map((section) => [section, total(section)])) as Record<(typeof PL_BASE_SECTIONS)[number], number>
    for (const section of PL_BASE_SECTIONS) {
      if (!lines.some((line) => line.month === month && line.section === section && line.path === '')) {
        rows.push({ year, month, section, path: '', amount: base[section] })
      }
    }
    const grossProfit = base['매출액'] - base['매출원가']
    const operatingProfit = grossProfit - base['판매비와관리비']
    const netIncome = operatingProfit + base['영업외수익'] - base['영업외비용'] - base['법인세등']
    rows.push(
      { year, month, section: '매출총이익', path: '', amount: grossProfit },
      { year, month, section: '영업이익', path: '', amount: operatingProfit },
      { year, month, section: '당기순이익', path: '', amount: netIncome },
    )
  }
  return rows
}

function normalizeBsRows(year: number, rows: readonly BsLineInput[]): BsLineInput[] {
  assertUnique(rows.map((row) => `${row.target_month}:${row.subject}`), 'rows')
  const subjects = new Set(rows.map((row) => `${row.target_month}:${row.subject}`))
  rows.forEach((row, index) => {
    if (!row.target_month.startsWith(`${year}-`)) throw invalidField(`rows.${index}.target_month`, `The month must fall in ${year}.`)
    if (row.parent_subject !== null && !subjects.has(`${row.target_month}:${row.parent_subject}`)) {
      throw invalidField(`rows.${index}.parent_subject`, 'The parent subject is missing from the same month.')
    }
  })
  const result = [...rows]
  for (const month of new Set(rows.map((row) => row.target_month))) {
    if (subjects.has(`${month}:부채와자본`)) continue
    const amountOf = (subject: string): number | undefined => rows.find((row) => row.target_month === month && row.subject === subject)?.amount
    const liabilities = amountOf('부채')
    const equity = amountOf('자본')
    if (liabilities !== undefined && equity !== undefined) {
      result.push({ target_month: month, subject: '부채와자본', parent_subject: null, sort_order: 4000, amount: liabilities + equity })
    }
  }
  return result
}

function assertUnique(keys: readonly string[], field: string): void {
  const seen = new Set<string>()
  keys.forEach((key, index) => {
    if (seen.has(key)) throw invalidField(`${field}.${index}`, 'Duplicate row.')
    seen.add(key)
  })
}
