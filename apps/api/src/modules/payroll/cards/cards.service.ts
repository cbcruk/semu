/**
 * Payroll card lifecycle: creation, additional-card rules, transitions and the withholding link.
 *
 * Functions run inside the caller's transaction and never open one, so the
 * seed and request handlers share them.
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../../app.types'
import { DomainError, notFound } from '../../../lib/domain-error'
import { addDays } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { YearMonth } from '../engine/rate-table.types'
import { PayrollError } from '../payroll-error'
import { findTerms } from '../settings/settings.repository'
import { ensurePayrollSettings } from '../settings/settings.service'
import { assertWithholdingOpen, isWithholdingFiled, syncPayrollLedgerRequirement } from '../withholding/withholding-link'
import { CARD_TRANSITIONS, INPUT_EDITORS } from './card-status'
import * as repo from './cards.repository'
import type { CardActor, CardGeneration, CardRow, CardTransitionName } from './cards.types'
import { defaultPaymentDate, paymentMonthOf, wagePeriodOf, withholdingDeadlineOf } from './cards.utils'
import { calculateStoredRow, loadCalculationContext } from './row-calculation'

/** Who acts on a card. */
export interface CardCaller {
  actor: CardActor
  userId: string
}

/** Days before the withholding deadline from which additional cards can no longer be created (spec 1.4). */
export const ADDITIONAL_CARD_DEADLINE_MARGIN_DAYS = 5

/** Why an additional card cannot be created, as `can-create-additional-card` reports it. */
export type AdditionalCardBlocker =
  | 'no_default_card'
  | 'parent_not_calculated'
  | 'input_card_exists'
  | 'withholding_filed'
  | 'withholding_deadline_near'

/** Inputs of {@linkcode createCard}. */
export interface CreateCardInput {
  generation: CardGeneration
  attributionMonth: YearMonth
  paymentDate?: PlainDate | undefined
  title?: string | undefined
  /** Card the additional card is created from; defaults to the month's default card. */
  parentCardId?: number | undefined
}

/**
 * Creates a payroll card for an attribution month.
 *
 * The month's first card of a generation is its `default` card; later cards
 * are `addition` cards and must pass {@linkcode additionalCardBlocker}.
 *
 * @throws {PayrollError} `WITHHOLDING_FILED` or `ADDITIONAL_CARD_NOT_ALLOWED`.
 */
export function createCard(deps: ServiceDeps, companyId: string, input: CreateCardInput, caller: CardCaller): CardRow {
  const { db, clock } = deps
  const now = clock.now()
  ensurePayrollSettings(db, companyId, now)
  const terms = findTerms(db, companyId)
  if (terms === undefined) throw new Error(`Payroll terms of ${companyId} are missing.`)
  const existing = repo.listCards(db, companyId, { generation: input.generation, attributionMonth: input.attributionMonth })
  const parent =
    input.parentCardId === undefined ? existing.find((card) => card.kind === 'default') : existing.find((card) => card.id === input.parentCardId)
  const paymentDate = input.paymentDate ?? parent?.payment_date ?? defaultPaymentDate(input.attributionMonth, terms)
  const kind = existing.length === 0 ? 'default' : 'addition'
  if (kind === 'addition') {
    const blocker = additionalCardBlocker(db, companyId, input.generation, parent, paymentDate, clock.today())
    if (blocker !== null) throw additionalCardError(blocker, paymentMonthOf(paymentDate))
  } else {
    assertWithholdingOpen(db, companyId, paymentMonthOf(paymentDate))
  }
  const period = wagePeriodOf(input.attributionMonth, terms.wage_period_start_day)
  const id = repo.insertCard(
    db,
    companyId,
    {
      generation: input.generation,
      kind,
      parentCardId: kind === 'addition' ? (parent?.id ?? null) : null,
      title: input.title ?? defaultTitle(input.attributionMonth, kind),
      attributionMonth: input.attributionMonth,
      paymentDate,
      periodStart: period.start,
      periodEnd: period.end,
      createdBy: caller.userId,
    },
    now,
  )
  syncPayrollLedgerRequirement(db, companyId, paymentMonthOf(paymentDate), now)
  return requireCard(db, companyId, id, input.generation)
}

/**
 * Checks the manual's additional-card rules (spec 1.4, 6.1).
 *
 * 1. The month needs a calculated (계산중 or 완료) parent card.
 * 2. No card of the company may still be `inputting`.
 * 3. The payment month's withholding return must not be filed.
 * 4. Creation stops {@linkcode ADDITIONAL_CARD_DEADLINE_MARGIN_DAYS} days before the withholding deadline (10th of the next month).
 *
 * @returns The first rule that fails, or `null` when a card may be created.
 */
export function additionalCardBlocker(
  db: DatabaseSync,
  companyId: string,
  generation: CardGeneration,
  parent: CardRow | undefined,
  paymentDate: PlainDate,
  today: PlainDate,
): AdditionalCardBlocker | null {
  if (parent === undefined) return 'no_default_card'
  if (parent.status === 'inputting') return 'parent_not_calculated'
  if (repo.countCardsInStatus(db, companyId, generation, 'inputting') > 0) return 'input_card_exists'
  const paymentMonth = paymentMonthOf(paymentDate)
  if (isWithholdingFiled(db, companyId, paymentMonth)) return 'withholding_filed'
  if (today >= addDays(withholdingDeadlineOf(paymentMonth), -ADDITIONAL_CARD_DEADLINE_MARGIN_DAYS)) return 'withholding_deadline_near'
  return null
}

/** Converts an additional-card blocker into the error a create request returns. */
export function additionalCardError(blocker: AdditionalCardBlocker, paymentMonth: YearMonth): PayrollError {
  if (blocker === 'withholding_filed') {
    return new PayrollError('WITHHOLDING_FILED', `The withholding return for payments in ${paymentMonth} is already filed.`, { payment_month: paymentMonth })
  }
  return new PayrollError('ADDITIONAL_CARD_NOT_ALLOWED', 'An additional payroll card cannot be created now.', { reason: blocker })
}

/**
 * Finds a card of a generation.
 *
 * @throws {DomainError} `NOT_FOUND`.
 */
export function requireCard(db: DatabaseSync, companyId: string, cardId: number, generation: CardGeneration): CardRow {
  const card = repo.findCard(db, companyId, cardId)
  if (card === undefined || card.generation !== generation) throw notFound('Payroll card')
  return card
}

/**
 * Rejects input edits the card's status does not allow for the caller (spec 5.11).
 *
 * @throws {DomainError} `INVALID_TRANSITION` when the card is locked for the caller.
 */
export function assertInputEditable(card: CardRow, caller: CardCaller): void {
  if (!INPUT_EDITORS[card.status].includes(caller.actor)) {
    throw new DomainError('INVALID_TRANSITION', `The payroll card is ${card.status} and cannot be edited by ${caller.actor === 'agency' ? 'agency staff' : 'the client'}.`)
  }
}

/** Rejects recalculation of a card whose withholding return is filed. */
export function assertRecalculable(db: DatabaseSync, card: CardRow): void {
  assertWithholdingOpen(db, card.company_id, paymentMonthOf(card.payment_date))
}

/**
 * Runs a card transition from {@linkcode CARD_TRANSITIONS}.
 *
 * Checks the actor, the source state, the withholding lock and the
 * `If-Match` version, then stamps the audit columns and re-syncs the
 * withholding requirement. `confirmInput` recalculates every row first.
 *
 * @throws {DomainError} `PERMISSION_DENIED`, `INVALID_TRANSITION` or `VERSION_CONFLICT`.
 * @throws {PayrollError} `WITHHOLDING_FILED`.
 */
export function transition(
  deps: ServiceDeps,
  card: CardRow,
  name: CardTransitionName,
  caller: CardCaller,
  expectedVersion: number,
  extra: { exportType?: string; exportReference?: string } = {},
): CardRow {
  const { db, clock } = deps
  const rule = CARD_TRANSITIONS[name]
  checkTransition(db, card, name, caller, expectedVersion)
  const now = clock.now()
  if (name === 'confirmInput') recalculateCard(db, card, now)
  const stamps: Parameters<typeof repo.transitionCard>[5] = {}
  if (name === 'requestApproval') Object.assign(stamps, { approval_requested_at: now, approval_requested_by: caller.userId })
  if (name === 'approve' || name === 'legacyFix') Object.assign(stamps, { approved_at: now, approved_by: caller.userId })
  if (name === 'reject') Object.assign(stamps, { rejected_at: now, rejected_by: caller.userId })
  if (name === 'cancelApproval' || name === 'legacyRelease') Object.assign(stamps, { approved_at: null, approved_by: null })
  if (name === 'sendPayslips' && card.payslips_sent_at === null) stamps.payslips_sent_at = now
  if (name === 'exportToDesk') Object.assign(stamps, { exported_at: now, export_type: extra.exportType ?? null, export_reference: extra.exportReference ?? null })
  const target = name === 'sendPayslips' && card.status === 'exported' ? 'exported' : rule.to
  if (!repo.transitionCard(db, card, rule.from, target, expectedVersion, stamps, now)) {
    throw new DomainError('VERSION_CONFLICT', 'The payroll card changed since you loaded it.')
  }
  syncPayrollLedgerRequirement(db, card.company_id, paymentMonthOf(card.payment_date), now)
  return requireCard(db, card.company_id, card.id, card.generation)
}

/**
 * Checks that a transition may run without running it, for steps that call an adapter first.
 *
 * @throws {DomainError} `PERMISSION_DENIED`, `INVALID_TRANSITION` or `VERSION_CONFLICT`.
 * @throws {PayrollError} `WITHHOLDING_FILED`.
 */
export function checkTransition(db: DatabaseSync, card: CardRow, name: CardTransitionName, caller: CardCaller, expectedVersion: number): void {
  const rule = CARD_TRANSITIONS[name]
  if (!(rule.actors as readonly CardActor[]).includes(caller.actor)) {
    throw new DomainError('PERMISSION_DENIED', `Only ${rule.actors.join(' or ')} may ${name} a payroll card.`)
  }
  if (!(rule.from as readonly string[]).includes(card.status)) {
    throw new DomainError('INVALID_TRANSITION', `Cannot ${name} a payroll card that is ${card.status}.`)
  }
  if (card.version !== expectedVersion) throw new DomainError('VERSION_CONFLICT', 'The payroll card changed since you loaded it.')
  if (rule.locksOnFiledWithholding) assertRecalculable(db, card)
}

/** Recalculates every row of a card with the current settings and rate tables. */
export function recalculateCard(db: DatabaseSync, card: CardRow, now: string): void {
  const context = loadCalculationContext(db, card)
  for (const row of repo.listRows(db, card.company_id, card.id)) repo.saveRowResult(db, card.company_id, row.id, calculateStoredRow(row, context), now)
}

/**
 * Updates a card's title and payment date (`PUT card/:c` without a status).
 *
 * Moving the payment date into or out of a month with a filed withholding
 * return is refused, and both months' requirements are re-synced.
 */
export function updateCardHeader(deps: ServiceDeps, card: CardRow, body: { title?: string | undefined; payment_date?: PlainDate | undefined }, caller: CardCaller): CardRow {
  const { db, clock } = deps
  assertInputEditable(card, caller)
  const paymentDate = body.payment_date ?? card.payment_date
  if (paymentDate !== card.payment_date) {
    assertWithholdingOpen(db, card.company_id, paymentMonthOf(card.payment_date))
    assertWithholdingOpen(db, card.company_id, paymentMonthOf(paymentDate))
  }
  const now = clock.now()
  repo.updateCardHeader(db, card.company_id, card.id, body.title ?? card.title, paymentDate, now)
  syncPayrollLedgerRequirement(db, card.company_id, [paymentMonthOf(card.payment_date), paymentMonthOf(paymentDate)], now)
  return requireCard(db, card.company_id, card.id, card.generation)
}

/**
 * Deletes a card that is still being entered.
 *
 * @throws {DomainError} `INVALID_TRANSITION` for any other status.
 */
export function removeCard(deps: ServiceDeps, card: CardRow, caller: CardCaller): void {
  const { db, clock } = deps
  if (card.status !== 'inputting') throw new DomainError('INVALID_TRANSITION', 'Only a payroll card that is still being entered can be deleted.')
  assertInputEditable(card, caller)
  repo.deleteCard(db, card.company_id, card.id)
  syncPayrollLedgerRequirement(db, card.company_id, paymentMonthOf(card.payment_date), clock.now())
}

function defaultTitle(month: YearMonth, kind: 'default' | 'addition'): string {
  const [year, monthNumber] = month.split('-')
  return `${year}년 ${monthNumber}월 ${kind === 'default' ? '급여 대장' : '추가 급여 대장'}`
}
