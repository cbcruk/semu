import { addDays, dayOfWeek } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { maskTail } from '../../../lib/masking'
import type { MandateRow, PaymentRow, SubscriptionCode, SubscriptionRow } from './billing.types'

/** Display names of the service cards on the plan screen. Product labels are Korean data. */
export const SUBSCRIPTION_NAMES: Record<SubscriptionCode, string> = { tax: '세무 아웃소싱', payroll: '급여 아웃소싱' }

/** Day of month on which monthly fees are withdrawn. */
export const BILLING_DAY = 25

/** Checks whether a subscription grants its plan on a date. */
export function isSubscribedOn(row: SubscriptionRow, today: string): boolean {
  return (row.status === 'active' || row.status === 'cancelled') && row.started_on <= today && (row.ended_on === null || today <= row.ended_on)
}

/** Moves a date forward past weekends and public holidays. */
export function nextBusinessDay(date: PlainDate, holidays: ReadonlySet<string>): PlainDate {
  let current = date
  while (dayOfWeek(current) === 0 || dayOfWeek(current) === 6 || holidays.has(current)) current = addDays(current, 1)
  return current
}

/** Serializes the subscription list of `GET /perm/subscription/`, always listing both products. */
export function serializeSubscriptions(rows: readonly SubscriptionRow[], today: string): Record<string, unknown>[] {
  return (['tax', 'payroll'] as const).map((code) => {
    const row = rows.find((candidate) => candidate.code === code && candidate.status !== 'ended') ?? rows.find((candidate) => candidate.code === code)
    return {
      code,
      name: SUBSCRIPTION_NAMES[code],
      is_subscribed: row !== undefined && isSubscribedOn(row, today),
      status: row?.status ?? null,
      started_on: row?.started_on ?? null,
      ended_on: row?.ended_on ?? null,
      monthly_fee: row?.monthly_fee ?? null,
    }
  })
}

/** Serializes a payment row for `GET /payment/`. */
export function serializePayment(row: PaymentRow, mandate: MandateRow | undefined): Record<string, unknown> {
  return {
    id: row.id,
    product_code: row.subscription_code,
    product_name: SUBSCRIPTION_NAMES[row.subscription_code],
    amount: row.amount,
    payment_date: row.scheduled_on,
    is_scheduled: row.status === 'scheduled',
    status: row.status,
    failure_reason: row.failure_reason,
    account: mandate === undefined ? null : { bank_code: mandate.bank_code, masked_number: mandate.account_masked },
  }
}

/** Masks a bank account number for display, e.g. `*********4321`. */
export function maskAccountNumber(accountNumber: string): string {
  return maskTail(accountNumber.replace(/-/g, ''), 4)
}
