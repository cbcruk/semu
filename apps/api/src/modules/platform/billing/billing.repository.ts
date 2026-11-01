import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne } from '../../../db/query'
import type { MandateRow, PaymentRow, PaymentStatus, SubscriptionCode, SubscriptionRow } from './billing.types'

/** Lists a company's subscriptions, newest first. */
export function listSubscriptions(db: DatabaseSync, companyId: string): SubscriptionRow[] {
  return queryAll<SubscriptionRow>(db, 'SELECT * FROM company_subscriptions WHERE company_id = ? ORDER BY started_on DESC, created_at DESC', [companyId])
}

/** Finds the subscription of a product that has not ended. */
export function findOpenSubscription(db: DatabaseSync, companyId: string, code: SubscriptionCode): SubscriptionRow | undefined {
  return queryOne<SubscriptionRow>(db, "SELECT * FROM company_subscriptions WHERE company_id = ? AND code = ? AND status <> 'ended'", [companyId, code])
}

/** Inserts a subscription. */
export function insertSubscription(db: DatabaseSync, row: SubscriptionRow): void {
  execute(
    db,
    `INSERT INTO company_subscriptions (id, company_id, code, status, started_on, ended_on, contract_id, monthly_fee, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.company_id, row.code, row.status, row.started_on, row.ended_on, row.contract_id, row.monthly_fee, row.created_at, row.updated_at],
  )
}

/** Updates a subscription's state and terms. */
export function updateSubscription(
  db: DatabaseSync,
  id: string,
  values: Pick<SubscriptionRow, 'status' | 'started_on' | 'ended_on' | 'monthly_fee' | 'contract_id' | 'updated_at'>,
): void {
  execute(db, 'UPDATE company_subscriptions SET status = ?, started_on = ?, ended_on = ?, monthly_fee = ?, contract_id = ?, updated_at = ? WHERE id = ?', [
    values.status,
    values.started_on,
    values.ended_on,
    values.monthly_fee,
    values.contract_id,
    values.updated_at,
    id,
  ])
}

/** Lists companies that have subscriptions, for the daily refresh. */
export function listSubscribedCompanyIds(db: DatabaseSync): string[] {
  return queryAll<{ company_id: string }>(db, 'SELECT DISTINCT company_id FROM company_subscriptions ORDER BY company_id').map((row) => row.company_id)
}

/** Writes the plan cache columns that {@linkcode decide} reads. */
export function writePlanCache(db: DatabaseSync, companyId: string, taxPlan: 'taxation' | null, hasPayrollPlan: boolean): void {
  execute(db, 'UPDATE companies SET tax_plan = ?, has_payroll_plan = ? WHERE id = ?', [taxPlan, hasPayrollPlan ? 1 : 0, companyId])
}

/** Lists a page of a company's payments, newest scheduled date first. */
export function listPayments(db: DatabaseSync, companyId: string, limit: number, offset: number): { rows: PaymentRow[]; count: number } {
  const rows = queryAll<PaymentRow>(db, 'SELECT * FROM payments WHERE company_id = ? ORDER BY scheduled_on DESC, id DESC LIMIT ? OFFSET ?', [
    companyId,
    limit,
    offset,
  ])
  const count = queryOne<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM payments WHERE company_id = ?', [companyId])?.n ?? 0
  return { rows, count }
}

/** Finds a payment within a company. */
export function findPayment(db: DatabaseSync, companyId: string, paymentId: number): PaymentRow | undefined {
  return queryOne<PaymentRow>(db, 'SELECT * FROM payments WHERE company_id = ? AND id = ?', [companyId, paymentId])
}

/** Finds the payment already scheduled for a subscription on a date. */
export function findScheduledPayment(db: DatabaseSync, companyId: string, code: SubscriptionCode, scheduledOn: string): PaymentRow | undefined {
  return queryOne<PaymentRow>(db, 'SELECT * FROM payments WHERE company_id = ? AND subscription_code = ? AND scheduled_on = ? AND parent_payment_id IS NULL', [
    companyId,
    code,
    scheduledOn,
  ])
}

/** Inserts a scheduled payment and returns its ID. */
export function insertPayment(
  db: DatabaseSync,
  row: { companyId: string; code: SubscriptionCode; amount: number; scheduledOn: string; mandateId: string | null; now: string },
): number {
  execute(
    db,
    "INSERT INTO payments (company_id, subscription_code, amount, scheduled_on, status, mandate_id, created_at) VALUES (?, ?, ?, ?, 'scheduled', ?, ?)",
    [row.companyId, row.code, row.amount, row.scheduledOn, row.mandateId, row.now],
  )
  return queryOne<{ id: number }>(db, 'SELECT last_insert_rowid() AS id')?.id ?? 0
}

/** Lists payments due for a withdrawal attempt on or before a date. */
export function listDuePayments(db: DatabaseSync, today: string): PaymentRow[] {
  return queryAll<PaymentRow>(db, "SELECT * FROM payments WHERE status IN ('scheduled','retrying') AND scheduled_on <= ? ORDER BY id", [today])
}

/** Records a payment's new status and an event. */
export function updatePaymentStatus(
  db: DatabaseSync,
  paymentId: number,
  status: PaymentStatus,
  values: { attemptedOn?: string; settledAt?: string; failureReason?: string | null; scheduledOn?: string },
  event: { type: string; actor: string; now: string },
): void {
  execute(
    db,
    `UPDATE payments SET status = ?, attempted_on = COALESCE(?, attempted_on), settled_at = COALESCE(?, settled_at),
       failure_reason = ?, scheduled_on = COALESCE(?, scheduled_on) WHERE id = ?`,
    [status, values.attemptedOn ?? null, values.settledAt ?? null, values.failureReason ?? null, values.scheduledOn ?? null, paymentId],
  )
  execute(db, 'INSERT INTO payment_events (payment_id, type, actor, created_at) VALUES (?, ?, ?, ?)', [paymentId, event.type, event.actor, event.now])
}

/** Inserts a CMS withdrawal mandate. */
export function insertMandate(db: DatabaseSync, row: MandateRow): void {
  execute(
    db,
    `INSERT INTO billing_mandates (id, company_id, business_number, bank_code, account_number_enc, account_masked, account_holder, payer_id_enc,
       consent_file_id, source, status, created_at, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.company_id,
      row.business_number,
      row.bank_code,
      row.account_number_enc,
      row.account_masked,
      row.account_holder,
      row.payer_id_enc,
      row.consent_file_id,
      row.source,
      row.status,
      row.created_at,
      row.registered_at,
    ],
  )
}

/** Finds a mandate by ID. */
export function findMandate(db: DatabaseSync, mandateId: string): MandateRow | undefined {
  return queryOne<MandateRow>(db, 'SELECT * FROM billing_mandates WHERE id = ?', [mandateId])
}

/** Finds the newest registered mandate of a company. */
export function findActiveMandate(db: DatabaseSync, companyId: string): MandateRow | undefined {
  return queryOne<MandateRow>(db, "SELECT * FROM billing_mandates WHERE company_id = ? AND status = 'registered' ORDER BY created_at DESC LIMIT 1", [
    companyId,
  ])
}
