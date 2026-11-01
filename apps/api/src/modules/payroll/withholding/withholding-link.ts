/**
 * Link between payroll ledgers and withholding tax filings (spec 6.1, architecture 4절).
 *
 * - The `payroll_ledger_closed` requirement of a withholding filing is
 *   `provided` while every card paid within the filing period is closed, and
 *   `pending` otherwise (also when the period has no card yet).
 * - Once that filing is `filed` or `settled`, reopening, rejecting or
 *   recalculating a card of the period and adding a card to it fail with
 *   `409 WITHHOLDING_FILED`.
 *
 * @example Keeping the requirement in sync after a card changes
 * ```ts
 * import { syncPayrollLedgerRequirement } from './withholding-link'
 *
 * syncPayrollLedgerRequirement(db, 'c-corp', '2026-10', clock.now())
 * ```
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'
import type { PlainDate } from '../../../lib/plain-date.types'
import { listFilingsCovering, setAutoLinkedResponse } from '../../filings/filings.repository'
import type { FilingRow, RequirementResponse } from '../../filings/filings.types'
import type { YearMonth } from '../engine/rate-table.types'
import { isClosed } from '../cards/card-status'
import { listCardsPaidBetween } from '../cards/cards.repository'
import { monthBounds } from '../cards/cards.utils'
import { PayrollError } from '../payroll-error'

/** Requirement code the withholding checklist links to payroll. */
export const PAYROLL_LEDGER_REQUIREMENT = 'payroll_ledger_closed'

/** Filing states from which the payroll ledgers of the period are locked. */
export const WITHHOLDING_LOCKED_STATUSES = ['filed', 'settled'] as const

/** Finds the withholding filing that covers a payment month, preferring the latest revision. */
export function findWithholdingFiling(db: DatabaseSync, companyId: string, paymentMonth: YearMonth): FilingRow | undefined {
  return listFilingsCovering(db, companyId, 'withholding_tax', `${paymentMonth}-01`)[0]
}

/** Whether the withholding return of a payment month is already filed or settled. */
export function isWithholdingFiled(db: DatabaseSync, companyId: string, paymentMonth: YearMonth): boolean {
  const filing = findWithholdingFiling(db, companyId, paymentMonth)
  return filing !== undefined && (WITHHOLDING_LOCKED_STATUSES as readonly string[]).includes(filing.status)
}

/**
 * Rejects a change to the payroll of a payment month whose withholding return is filed.
 *
 * @throws {PayrollError} `WITHHOLDING_FILED` (409).
 */
export function assertWithholdingOpen(db: DatabaseSync, companyId: string, paymentMonth: YearMonth): void {
  if (isWithholdingFiled(db, companyId, paymentMonth)) {
    throw new PayrollError('WITHHOLDING_FILED', `The withholding return for payments in ${paymentMonth} is already filed.`, { payment_month: paymentMonth })
  }
}

/** Computes the `payroll_ledger_closed` response for a filing period from its cards. */
export function payrollLedgerResponse(db: DatabaseSync, companyId: string, periodStart: PlainDate, periodEnd: PlainDate): RequirementResponse {
  const cards = listCardsPaidBetween(db, companyId, periodStart, periodEnd)
  return cards.length > 0 && cards.every((card) => isClosed(card.status)) ? 'provided' : 'pending'
}

/** Recomputes the `payroll_ledger_closed` response of one filing. */
export function syncPayrollLedgerForFiling(db: DatabaseSync, filing: FilingRow, now: string): void {
  setAutoLinkedResponse(db, filing.company_id, filing.id, PAYROLL_LEDGER_REQUIREMENT, payrollLedgerResponse(db, filing.company_id, filing.period_start, filing.period_end), now)
}

/**
 * Recomputes the `payroll_ledger_closed` requirement of the withholding filings covering payment months.
 *
 * Call it in the same transaction as any change to a card's status,
 * payment date or existence. Filings without the requirement are untouched.
 */
export function syncPayrollLedgerRequirement(db: DatabaseSync, companyId: string, paymentMonths: YearMonth | readonly YearMonth[], now: string): void {
  const months = typeof paymentMonths === 'string' ? [paymentMonths] : [...new Set(paymentMonths)]
  const seen = new Set<string>()
  for (const month of months) {
    for (const filing of listFilingsCovering(db, companyId, 'withholding_tax', monthBounds(month).start)) {
      if (seen.has(filing.id)) continue
      seen.add(filing.id)
      syncPayrollLedgerForFiling(db, filing, now)
    }
  }
}
