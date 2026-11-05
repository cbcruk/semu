import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AppDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { maskTail } from '../../../lib/masking'
import { createFakeGiroPaymentAdapter } from './giro-payment.adapter'
import {
  findCompanyGiroPayment,
  findGiro,
  findGiroByEPayNo,
  findGiroPayment,
  findRegisteredBankAccount,
  insertGiro,
  insertGiroAction,
  insertGiroPayment,
  lastGiroAction,
  listCompanyGiroPayments,
  listGirosInStatus,
  listRegisteredBankAccounts,
  settleGiroPayment,
  updateGiroFields,
  updateGiroStatus,
  usernameOf,
} from './giros.repository'
import type { GiroPaymentAdapter, GiroRow, GiroStatus, GiroUpsertResult, PayGiroInput, PaymentAccountCandidate, ScrapedGiroBill } from './giros.types'
import { accountDigits, serializeGiro } from './giros.utils'

const RECENT_ACCOUNT_LIMIT = 3
const MASK_VISIBLE = 4

/** Serializes a bill with its latest action. */
export function giroResponse(db: DatabaseSync, row: GiroRow): Record<string, unknown> {
  return serializeGiro(row, lastGiroAction(db, row.id))
}

/** Finds a bill or throws `NOT_FOUND`. */
export function requireGiro(db: DatabaseSync, companyId: string, id: string): GiroRow {
  const row = findGiro(db, companyId, id)
  if (row === undefined) throw notFound('Giro')
  return row
}

/**
 * Marks a bill paid through another channel (`todo|unknown → done`, shown as 수동 완료).
 *
 * @throws {DomainError} `INVALID_TRANSITION` from any other status.
 */
export function manualDoneGiro(deps: Pick<AppDeps, 'db' | 'clock'>, companyId: string, id: string, userId: string, memo: string): GiroRow {
  return moveGiro(deps, companyId, id, userId, memo, ['todo', 'unknown'], 'done', 'manual_done')
}

/**
 * Hides a bill from every tab (`todo|unknown → hidden`); there is no restore.
 *
 * @throws {DomainError} `INVALID_TRANSITION` from any other status.
 */
export function hideGiro(deps: Pick<AppDeps, 'db' | 'clock'>, companyId: string, id: string, userId: string, memo: string): GiroRow {
  return moveGiro(deps, companyId, id, userId, memo, ['todo', 'unknown'], 'hidden', 'hide')
}

/**
 * Upserts the bills of a full internet giro refresh, keyed by `e_pay_no`.
 *
 * - New bills start as `todo`, or `done` (`scraped`) when already paid.
 * - Known `todo`/`unknown` bills seen paid become `done` (`scraped`); an
 *   `unknown` bill that reappears unpaid returns to `todo`.
 * - `todo` bills missing from the refresh become `unknown` (기한 초과, 고지 취소, 직접 납부).
 * - Hidden and done bills keep their status.
 */
export function upsertScrapedGiros(db: DatabaseSync, companyId: string, bills: readonly ScrapedGiroBill[], now: string): GiroUpsertResult {
  return transaction(db, () => {
    const result: GiroUpsertResult = { inserted: 0, updated: 0, marked_unknown: 0 }
    const seen = new Set<string>()
    for (const bill of bills) {
      seen.add(bill.e_pay_no)
      const existing = findGiroByEPayNo(db, companyId, bill.e_pay_no)
      if (existing === undefined) {
        const id = randomUUID()
        insertGiro(db, companyId, id, bill, bill.is_paid === true ? 'done' : 'todo', bill.is_paid === true ? 'scraped' : null, now)
        insertGiroAction(db, id, 'created', '', 'system', now)
        result.inserted++
        continue
      }
      updateGiroFields(db, existing.id, bill, now)
      result.updated++
      if (bill.is_paid === true && updateGiroStatus(db, existing.id, ['todo', 'unknown'], 'done', 'scraped', existing.memo, now)) {
        insertGiroAction(db, existing.id, 'scraped_done', '', 'system', now)
      } else if (bill.is_paid !== true && updateGiroStatus(db, existing.id, ['unknown'], 'todo', null, existing.memo, now)) {
        insertGiroAction(db, existing.id, 'reopened', '', 'system', now)
      }
    }
    for (const todo of listGirosInStatus(db, companyId, ['todo'])) {
      if (seen.has(todo.e_pay_no)) continue
      if (updateGiroStatus(db, todo.id, ['todo'], 'unknown', null, todo.memo, now)) {
        insertGiroAction(db, todo.id, 'unknown', '', 'system', now)
        result.marked_unknown++
      }
    }
    return result
  })
}

/** Lists withdrawal account candidates: recently used accounts first, then registered demand-deposit accounts. */
export function listPaymentAccounts(deps: Pick<AppDeps, 'db' | 'cipher'>, companyId: string): PaymentAccountCandidate[] {
  const candidates: PaymentAccountCandidate[] = []
  const seen = new Set<string>()
  for (const payment of listCompanyGiroPayments(deps.db, companyId)) {
    if (candidates.length >= RECENT_ACCOUNT_LIMIT) break
    const number = deps.cipher.decrypt(payment.account_number_enc)
    const key = `${payment.bank_code}:${number}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ id: `giro_payment:${payment.id}`, source: 'recent', bank_code: payment.bank_code, account_number: maskTail(number, MASK_VISIBLE), account_name: null })
  }
  for (const account of listRegisteredBankAccounts(deps.db, companyId)) {
    const number = deps.cipher.decrypt(account.account_number_enc)
    candidates.push({
      id: `bank_account:${account.id}`,
      source: 'registered',
      bank_code: account.bank_code,
      account_number: maskTail(number, MASK_VISIBLE),
      account_name: account.account_name,
    })
  }
  return candidates
}

/**
 * Pays a `todo` bill through the giro gateway and records the attempt.
 *
 * The password goes to the adapter only. A repeated `request_id` returns the
 * earlier attempt instead of paying twice.
 *
 * @throws {DomainError} `INVALID_TRANSITION` unless the bill is `todo`, `VALIDATION_FAILED` for a bad account or amount.
 */
export async function payGiro(
  deps: Pick<AppDeps, 'db' | 'clock' | 'cipher' | 'giroPayment'>,
  companyId: string,
  id: string,
  userId: string,
  input: PayGiroInput,
): Promise<{ status: 'succeeded' | 'failed'; result_code: string | null; result_message: string | null; giro: Record<string, unknown> }> {
  const giro = requireGiro(deps.db, companyId, id)
  const requestId = input.requestId ?? randomUUID()
  const previous = findGiroPayment(deps.db, giro.id, requestId)
  if (previous?.status === 'requested') throw new DomainError('INVALID_TRANSITION', 'This payment is still being processed.')
  if (previous !== undefined) {
    return { status: previous.status, result_code: previous.result_code, result_message: previous.result_message, giro: giroResponse(deps.db, requireGiro(deps.db, companyId, id)) }
  }
  if (giro.status !== 'todo') throw new DomainError('INVALID_TRANSITION', `The giro is ${giro.status} and cannot be paid.`)
  if (input.amount !== undefined && input.amount !== giro.pay_amount) throw invalidField('amount', 'Must equal the amount due.')
  const { bankCode, accountNumber } = resolveAccount(deps, companyId, input)
  const paymentId = randomUUID()
  const username = usernameOf(deps.db, userId)
  insertGiroPayment(deps.db, {
    id: paymentId,
    giro_id: giro.id,
    request_id: requestId,
    bank_code: bankCode,
    account_number_enc: deps.cipher.encrypt(accountNumber),
    account_number_tail: accountNumber.slice(-MASK_VISIBLE),
    amount: giro.pay_amount,
    requested_by: userId,
    created_at: deps.clock.now(),
  })
  const adapter: GiroPaymentAdapter = deps.giroPayment ?? createFakeGiroPaymentAdapter()
  const result = await adapter.pay({
    companyId,
    giroId: giro.id,
    ePayNo: giro.e_pay_no,
    giroType: giro.giro_type,
    bankCode,
    accountNumber,
    accountPassword: input.accountPassword,
    amount: giro.pay_amount,
    requestId,
  })
  const settled = transaction(deps.db, () => {
    const now = deps.clock.now()
    settleGiroPayment(deps.db, paymentId, result.ok, result.result_code, result.result_message)
    if (result.ok) {
      updateGiroStatus(deps.db, giro.id, ['todo', 'unknown'], 'done', 'paid_in_app', giro.memo, now)
      insertGiroAction(deps.db, giro.id, 'paid', '', username, now)
    } else {
      insertGiroAction(deps.db, giro.id, 'pay_failed', result.result_message, username, now)
    }
    return requireGiro(deps.db, companyId, id)
  })
  return { status: result.ok ? 'succeeded' : 'failed', result_code: result.result_code, result_message: result.result_message, giro: giroResponse(deps.db, settled) }
}

function resolveAccount(deps: Pick<AppDeps, 'db' | 'cipher'>, companyId: string, input: PayGiroInput): { bankCode: string; accountNumber: string } {
  if (input.paymentAccountId !== undefined) {
    const [kind, ref] = input.paymentAccountId.split(':')
    if (kind === 'bank_account' && ref !== undefined) {
      const account = findRegisteredBankAccount(deps.db, companyId, ref)
      if (account !== undefined) return { bankCode: account.bank_code, accountNumber: accountDigits(deps.cipher.decrypt(account.account_number_enc)) }
    }
    if (kind === 'giro_payment' && ref !== undefined) {
      const payment = findCompanyGiroPayment(deps.db, companyId, ref)
      if (payment !== undefined) return { bankCode: payment.bank_code, accountNumber: deps.cipher.decrypt(payment.account_number_enc) }
    }
    throw invalidField('payment_account_id', 'Unknown payment account.')
  }
  if (input.bankCode === undefined || input.accountNumber === undefined) {
    throw invalidField('account_number', 'Choose a payment account or enter a bank code and account number.')
  }
  return { bankCode: input.bankCode, accountNumber: accountDigits(input.accountNumber) }
}

function moveGiro(
  deps: Pick<AppDeps, 'db' | 'clock'>,
  companyId: string,
  id: string,
  userId: string,
  memo: string,
  from: readonly GiroStatus[],
  to: GiroStatus,
  action: 'manual_done' | 'hide',
): GiroRow {
  return transaction(deps.db, () => {
    const giro = requireGiro(deps.db, companyId, id)
    const now = deps.clock.now()
    if (!updateGiroStatus(deps.db, giro.id, from, to, to === 'done' ? 'manual' : null, memo, now)) {
      throw new DomainError('INVALID_TRANSITION', `The giro is ${giro.status} and does not allow ${action}.`)
    }
    insertGiroAction(deps.db, giro.id, action, memo, usernameOf(deps.db, userId), now)
    return requireGiro(deps.db, companyId, id)
  })
}
