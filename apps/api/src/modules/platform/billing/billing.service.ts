import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../../app.types'
import { queryAll, transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { fromParts, toParts } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { findCompanyByBusinessNumber } from '../company-profile/company-profile.repository'
import type { PlatformDeps } from '../platform.types'
import { newId } from '../platform.utils'
import {
  findActiveMandate,
  findMandate,
  findOpenSubscription,
  findPayment,
  findScheduledPayment,
  insertMandate,
  insertPayment,
  insertSubscription,
  listDuePayments,
  listSubscribedCompanyIds,
  listSubscriptions,
  updatePaymentStatus,
  updateSubscription,
  writePlanCache,
} from './billing.repository'
import type { MandateRow, PaymentRow, SubscriptionChange, SubscriptionCode, SubscriptionRow } from './billing.types'
import { BILLING_DAY, isSubscribedOn, maskAccountNumber, nextBusinessDay } from './billing.utils'

/**
 * Recomputes `companies.tax_plan` and `companies.has_payroll_plan` from the subscriptions.
 *
 * These columns are a cache read by {@linkcode decide}; every subscription
 * change goes through here so entitlement checks never disagree with billing.
 */
export function syncCompanyPlans(db: DatabaseSync, companyId: string, today: string): void {
  const rows = listSubscriptions(db, companyId)
  const holds = (code: SubscriptionCode): boolean => rows.some((row) => row.code === code && isSubscribedOn(row, today))
  writePlanCache(db, companyId, holds('tax') ? 'taxation' : null, holds('payroll'))
}

/**
 * Creates or updates a company's open subscription for a product and refreshes the plan cache.
 *
 * @throws {DomainError} `INVALID_TRANSITION` when ending a subscription that does not exist.
 */
export function changeSubscription(deps: ServiceDeps, companyId: string, code: SubscriptionCode, change: SubscriptionChange): SubscriptionRow {
  return transaction(deps.db, () => applySubscriptionChange(deps, companyId, code, change))
}

/** Same as {@linkcode changeSubscription} for callers that already hold a transaction. */
export function applySubscriptionChange(deps: ServiceDeps, companyId: string, code: SubscriptionCode, change: SubscriptionChange): SubscriptionRow {
  if (change.endedOn !== null && change.endedOn < change.startedOn) throw invalidField('ended_on', 'The end date must not precede the start date.')
  const now = deps.clock.now()
  const open = findOpenSubscription(deps.db, companyId, code)
  if (open === undefined) {
    if (change.status === 'ended' || change.status === 'cancelled') {
      throw new DomainError('INVALID_TRANSITION', 'There is no open subscription to end.')
    }
    insertSubscription(deps.db, {
      id: newId('sub'),
      company_id: companyId,
      code,
      status: change.status,
      started_on: change.startedOn,
      ended_on: change.endedOn,
      contract_id: change.contractId ?? null,
      monthly_fee: change.monthlyFee,
      created_at: now,
      updated_at: now,
    })
  } else {
    updateSubscription(deps.db, open.id, {
      status: change.status,
      started_on: change.startedOn,
      ended_on: change.endedOn,
      monthly_fee: change.monthlyFee,
      contract_id: change.contractId ?? open.contract_id,
      updated_at: now,
    })
  }
  syncCompanyPlans(deps.db, companyId, deps.clock.today())
  const latest = listSubscriptions(deps.db, companyId).find((row) => row.code === code)
  if (latest === undefined) throw notFound('Subscription')
  return latest
}

/**
 * Daily job that starts pending subscriptions, ends expired ones and refreshes plan caches.
 *
 * @returns The number of companies refreshed.
 */
export function refreshSubscriptions(deps: ServiceDeps): number {
  const today = deps.clock.today()
  const now = deps.clock.now()
  const companyIds = listSubscribedCompanyIds(deps.db)
  transaction(deps.db, () => {
    for (const companyId of companyIds) {
      for (const row of listSubscriptions(deps.db, companyId)) {
        const next =
          row.status === 'pending' && row.started_on <= today
            ? 'active'
            : (row.status === 'active' || row.status === 'cancelled') && row.ended_on !== null && row.ended_on < today
              ? 'ended'
              : null
        if (next !== null) updateSubscription(deps.db, row.id, { ...row, status: next, updated_at: now })
      }
      syncCompanyPlans(deps.db, companyId, today)
    }
  })
  return companyIds.length
}

/**
 * Monthly billing job: schedules each active subscription's fee on the billing day and withdraws due payments.
 *
 * The billing day moves to the next business day over weekends and public
 * holidays. In production the CMS result arrives the next afternoon; the fake
 * gateway answers immediately.
 *
 * @returns The payments attempted in this run.
 */
export async function runBillingCycle(deps: PlatformDeps): Promise<PaymentRow[]> {
  const today = deps.clock.today()
  const now = deps.clock.now()
  const holidays = new Set(queryAll<{ date: string }>(deps.db, 'SELECT date FROM public_holidays').map((row) => row.date))
  const { year, month } = toParts(today)
  const billingDate = nextBusinessDay(fromParts(year, month, BILLING_DAY), holidays)
  transaction(deps.db, () => {
    for (const companyId of listSubscribedCompanyIds(deps.db)) {
      for (const row of listSubscriptions(deps.db, companyId)) {
        if (!isSubscribedOn(row, billingDate) || row.monthly_fee <= 0) continue
        if (findScheduledPayment(deps.db, companyId, row.code, billingDate) !== undefined) continue
        insertPayment(deps.db, {
          companyId,
          code: row.code,
          amount: row.monthly_fee,
          scheduledOn: billingDate,
          mandateId: findActiveMandate(deps.db, companyId)?.id ?? null,
          now,
        })
      }
    }
  })
  const attempted: PaymentRow[] = []
  for (const payment of listDuePayments(deps.db, today)) {
    const mandate = payment.mandate_id === null ? findActiveMandate(deps.db, payment.company_id) : findMandate(deps.db, payment.mandate_id)
    const outcome =
      mandate === undefined
        ? { ok: false as const, reason: 'NO_MANDATE' }
        : await deps.billing.withdraw({
            paymentId: payment.id,
            amount: payment.amount,
            bankCode: mandate.bank_code,
            accountNumber: deps.cipher.decrypt(mandate.account_number_enc),
            accountHolder: mandate.account_holder,
          })
    updatePaymentStatus(
      deps.db,
      payment.id,
      outcome.ok ? 'paid' : 'failed',
      outcome.ok ? { attemptedOn: today, settledAt: now } : { attemptedOn: today, failureReason: outcome.reason },
      { type: outcome.ok ? 'paid' : 'failed', actor: 'system', now },
    )
    const updated = findPayment(deps.db, payment.company_id, payment.id)
    if (updated !== undefined) attempted.push(updated)
  }
  return attempted
}

/**
 * Queues a failed payment for another withdrawal attempt, an agency desk action.
 *
 * @throws {DomainError} `INVALID_TRANSITION` unless the payment failed.
 */
export function retryPayment(deps: ServiceDeps, companyId: string, paymentId: number, retryOn: PlainDate, actorId: string): PaymentRow {
  const payment = findPayment(deps.db, companyId, paymentId)
  if (payment === undefined) throw notFound('Payment')
  if (payment.status !== 'failed') throw new DomainError('INVALID_TRANSITION', 'Only failed payments can be retried.')
  updatePaymentStatus(deps.db, paymentId, 'retrying', { scheduledOn: retryOn }, { type: 'retrying', actor: actorId, now: deps.clock.now() })
  const updated = findPayment(deps.db, companyId, paymentId)
  if (updated === undefined) throw notFound('Payment')
  return updated
}

/**
 * Registers an online CMS withdrawal consent and forwards it to the billing gateway.
 *
 * The account number and payer ID are encrypted; the consent is linked to the
 * company with the same business number when one exists.
 */
export async function registerWithdrawalConsent(
  deps: PlatformDeps,
  input: { businessNumber: string; bankCode: string; accountNumber: string; accountHolder: string; payerId: string },
): Promise<MandateRow> {
  const id = newId('mandate')
  const outcome = await deps.billing.registerMandate({ mandateId: id, ...input })
  const now = deps.clock.now()
  const row: MandateRow = {
    id,
    company_id: findCompanyByBusinessNumber(deps.db, input.businessNumber)?.id ?? null,
    business_number: input.businessNumber,
    bank_code: input.bankCode,
    account_number_enc: deps.cipher.encrypt(input.accountNumber),
    account_masked: maskAccountNumber(input.accountNumber),
    account_holder: input.accountHolder,
    payer_id_enc: deps.cipher.encrypt(input.payerId),
    consent_file_id: null,
    source: 'online',
    status: outcome.ok ? 'registered' : 'rejected',
    created_at: now,
    registered_at: outcome.ok ? now : null,
  }
  insertMandate(deps.db, row)
  return row
}
