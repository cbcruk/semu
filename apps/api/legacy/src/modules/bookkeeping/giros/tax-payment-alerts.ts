import { randomUUID } from 'node:crypto'
import type { ServiceDeps } from '../../../app.types'
import { execute, queryAll, queryOne } from '../../../db/query'
import { addDays, dayOfWeek, daysBetween } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { TaxAlertMessage, TaxAlertNotifier, TaxAlertRunResult } from './giros.types'

const ALERT_WINDOW_DAYS = 3

/**
 * Sends the weekday 09:30 "낼 세금" reminders for bills due within three days.
 *
 * Targets `todo` bills with `due_date − today ∈ [0, 3]` and every user with an
 * enabled `tax_payment_due` subscription for the company. A delivery row is
 * written per user, bill and day, so running the job twice sends nothing new.
 * Weekends and public holidays are skipped.
 */
export async function sendTaxPaymentAlerts(deps: Pick<ServiceDeps, 'db' | 'clock'>, notifier: TaxAlertNotifier, today: PlainDate): Promise<TaxAlertRunResult> {
  const weekday = dayOfWeek(today)
  const holiday = queryOne<{ found: number }>(deps.db, 'SELECT 1 AS found FROM public_holidays WHERE date = ?', [today]) !== undefined
  if (weekday === 0 || weekday === 6 || holiday) return { sent: 0, skipped: 0, holiday: true }

  const targets = queryAll<{ giro_id: string; company_id: string; tax_name: string; pay_amount: number; due_date: PlainDate; user_id: string }>(
    deps.db,
    `SELECT g.id AS giro_id, g.company_id, g.tax_name, g.pay_amount, g.due_date, s.user_id
     FROM giros g JOIN notification_subscriptions s ON s.company_id = g.company_id AND s.kind = 'tax_payment_due' AND s.enabled = 1
     WHERE g.status = 'todo' AND g.due_date BETWEEN ? AND ? ORDER BY g.due_date, g.id, s.user_id`,
    [today, addDays(today, ALERT_WINDOW_DAYS)],
  )
  let sent = 0
  let skipped = 0
  for (const target of targets) {
    const delivered = queryOne<{ found: number }>(
      deps.db,
      "SELECT 1 AS found FROM notification_deliveries WHERE company_id = ? AND user_id = ? AND kind = 'tax_payment_due' AND target_id = ? AND sent_on = ?",
      [target.company_id, target.user_id, target.giro_id, today],
    )
    if (delivered !== undefined) {
      skipped++
      continue
    }
    const message: TaxAlertMessage = {
      companyId: target.company_id,
      userId: target.user_id,
      kind: 'tax_payment_due',
      giroId: target.giro_id,
      taxName: target.tax_name,
      payAmount: target.pay_amount,
      dueDate: target.due_date,
      daysLeft: daysBetween(today, target.due_date),
    }
    await notifier.send(message)
    execute(
      deps.db,
      `INSERT INTO notification_deliveries (id, company_id, user_id, kind, target_id, sent_on, payload, created_at)
       VALUES (?, ?, ?, 'tax_payment_due', ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [randomUUID(), target.company_id, target.user_id, target.giro_id, today, JSON.stringify(message), deps.clock.now()],
    )
    sent++
  }
  return { sent, skipped, holiday: false }
}

/** Creates a {@linkcode TaxAlertNotifier} that keeps sent messages in memory, for tests and local runs. */
export function createMemoryTaxAlertNotifier(): TaxAlertNotifier & { readonly sent: TaxAlertMessage[] } {
  const sent: TaxAlertMessage[] = []
  return {
    sent,
    async send(message): Promise<void> {
      sent.push(message)
    },
  }
}
