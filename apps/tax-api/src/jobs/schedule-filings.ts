import type { DatabaseSync } from 'node:sqlite'
import { queryAll, transaction } from '../db/query'
import type { Clock } from '../lib/clock.types'
import { addDays } from '../lib/plain-date'
import type { PlainDate } from '../lib/plain-date.types'
import { listCompanies } from '../modules/companies/companies.repository'
import { toCalendarCompany } from '../modules/companies/companies.utils'
import { closeAllCardsOfSource } from '../modules/action-cards/action-cards.repository'
import {
  insertEvent,
  insertFilingIfAbsent,
  listScheduledInWindow,
  refreshDeadlines,
  updateFilingStatus,
} from '../modules/filings/filings.repository'
import { requirementsFor } from '../modules/filings/requirement-templates'
import { resolveFilingPeriods } from '../modules/tax-calendar/tax-calendar'

/** Counts of what one scheduling run changed. */
export interface ScheduleResult {
  created: number
  updated: number
  cancelled: number
}

const SYSTEM_ACTOR = { type: 'system', id: null } as const

/**
 * Creates, refreshes and cancels scheduled filings for every company.
 *
 * - Creates filings whose payment deadline falls within the horizon.
 * - Recomputes deadlines of `scheduled`/`requested` filings, so holiday-table
 *   edits and company setting changes take effect.
 * - Cancels `scheduled` filings in the window that no longer apply, such as
 *   monthly withholding after the company moves to semiannual payment.
 *
 * The run is idempotent: repeating it changes nothing.
 */
export function scheduleFilings(db: DatabaseSync, clock: Clock, horizonDays = 120): ScheduleResult {
  const today = clock.today()
  const to = addDays(today, horizonDays)
  const now = clock.now()
  const holidays = new Set(queryAll<{ date: PlainDate }>(db, 'SELECT date FROM public_holidays').map((row) => row.date))
  const result: ScheduleResult = { created: 0, updated: 0, cancelled: 0 }

  for (const company of listCompanies(db)) {
    const periods = resolveFilingPeriods({ company: toCalendarCompany(company), from: today, to, holidays })
    transaction(db, () => {
      for (const period of periods) {
        const templates = requirementsFor(period.taxType, period.kind, company.has_payroll_plan === 1)
        if (insertFilingIfAbsent(db, company.id, period, templates, now) !== null) result.created++
        else if (refreshDeadlines(db, company.id, period, now)) result.updated++
      }
      const expected = new Set(periods.map((period) => `${period.taxType}:${period.taxPeriodKey}`))
      for (const filing of listScheduledInWindow(db, company.id, today, to)) {
        if (expected.has(`${filing.tax_type}:${filing.tax_period_key}`)) continue
        if (updateFilingStatus(db, filing, 'cancelled', {}, now) === 0) continue
        insertEvent(db, filing, SYSTEM_ACTOR, 'cancel', filing.status, 'cancelled', { reason: 'no_longer_applicable' }, now)
        closeAllCardsOfSource(db, company.id, filing.id, now)
        result.cancelled++
      }
    })
  }
  return result
}
