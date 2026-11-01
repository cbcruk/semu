import type { DatabaseSync } from 'node:sqlite'
import type { PayrollIncomeType } from '../engine/engine.types'
import type { YearMonth } from '../engine/rate-table.types'
import { isClosed } from '../cards/card-status'
import { listCardsPaidBetween, listRowsOfCards } from '../cards/cards.repository'
import type { PayrollRowRecord } from '../cards/cards.types'
import { monthBounds } from '../cards/cards.utils'
import { listCompletedSettlementsPaidBetween } from '../severance/severance.repository'
import { findWithholdingFiling, payrollLedgerResponse } from './withholding-link'

/** One line of the withholding return (원천징수이행상황신고서) aggregated from payroll. */
export interface WithholdingLine {
  code: 'A01' | 'A03' | 'A21' | 'A25' | 'A40'
  label: string
  headcount: number
  total_paid: number
  taxable_paid: number
  income_tax: number
  local_income_tax: number
  /** The code mapping is unconfirmed (spec 6.1). */
  verified: false
}

/** Per-payment-month withholding aggregates handed to the tax agency. */
export interface WithholdingSummary {
  payment_month: YearMonth
  ledger_closed: boolean
  open_card_ids: number[]
  closed_card_ids: number[]
  filing: { id: string; status: string; tax_period_key: string } | null
  lines: WithholdingLine[]
  totals: { headcount: number; total_paid: number; income_tax: number; local_income_tax: number }
  verified: false
}

const LINES: readonly { code: WithholdingLine['code']; label: string; incomeTypes: readonly PayrollIncomeType[] }[] = [
  { code: 'A01', label: '근로소득 간이세액', incomeTypes: ['wage_monthly', 'wage_daily', 'wage_hourly'] },
  { code: 'A03', label: '일용근로', incomeTypes: ['daily'] },
  { code: 'A25', label: '사업소득 매월징수', incomeTypes: ['business'] },
  { code: 'A40', label: '기타소득', incomeTypes: ['other'] },
]

/**
 * Aggregates the withholding of a payment month from closed payroll cards and completed severance settlements.
 *
 * Only closed cards count; `open_card_ids` lists those still in progress.
 * Headcount counts distinct employees, or names for rows without one.
 * `A21` reports completed retirement settlements paid in the month. All
 * codes and the split of totals are unverified.
 */
export function withholdingSummary(db: DatabaseSync, companyId: string, paymentMonth: YearMonth): WithholdingSummary {
  const { start, end } = monthBounds(paymentMonth)
  const cards = listCardsPaidBetween(db, companyId, start, end)
  const closed = cards.filter((card) => isClosed(card.status))
  const rows = listRowsOfCards(
    db,
    companyId,
    closed.map((card) => card.id),
  )
  const lines: WithholdingLine[] = LINES.map((line) => lineOf(line.code, line.label, rows.filter((row) => line.incomeTypes.includes(row.income_type))))
  const severance = listCompletedSettlementsPaidBetween(db, companyId, start, end)
  lines.splice(1, 0, {
    code: 'A21',
    label: '퇴직소득',
    headcount: new Set(severance.map((row) => row.employee_id)).size,
    total_paid: severance.reduce((total, row) => total + row.severance_pay, 0),
    taxable_paid: severance.reduce((total, row) => total + row.severance_pay, 0),
    income_tax: severance.reduce((total, row) => total + row.retirement_income_tax, 0),
    local_income_tax: severance.reduce((total, row) => total + row.local_income_tax, 0),
    verified: false,
  })
  const filing = findWithholdingFiling(db, companyId, paymentMonth)
  return {
    payment_month: paymentMonth,
    ledger_closed: payrollLedgerResponse(db, companyId, start, end) === 'provided',
    open_card_ids: cards.filter((card) => !isClosed(card.status)).map((card) => card.id),
    closed_card_ids: closed.map((card) => card.id),
    filing: filing === undefined ? null : { id: filing.id, status: filing.status, tax_period_key: filing.tax_period_key },
    lines,
    totals: {
      headcount: lines.reduce((total, line) => total + line.headcount, 0),
      total_paid: lines.reduce((total, line) => total + line.total_paid, 0),
      income_tax: lines.reduce((total, line) => total + line.income_tax, 0),
      local_income_tax: lines.reduce((total, line) => total + line.local_income_tax, 0),
    },
    verified: false,
  }
}

function lineOf(code: WithholdingLine['code'], label: string, rows: readonly PayrollRowRecord[]): WithholdingLine {
  return {
    code,
    label,
    headcount: new Set(rows.map((row) => (row.employee_id === null ? `name:${row.name}` : `id:${row.employee_id}`))).size,
    total_paid: rows.reduce((total, row) => total + row.gross_pay, 0),
    taxable_paid: rows.reduce((total, row) => total + row.taxable_pay, 0),
    income_tax: rows.reduce((total, row) => total + row.income_tax, 0),
    local_income_tax: rows.reduce((total, row) => total + row.local_income_tax, 0),
    verified: false,
  }
}
