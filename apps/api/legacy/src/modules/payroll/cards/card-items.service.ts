/**
 * Card-level payment and deduction items (`payment-items`, `deduction-items` and their `bulk` edits).
 *
 * New items are created in the settings menu only; a card stores which
 * items it uses this month and bulk-edits their amounts on its rows.
 *
 * @module
 */
import type { z } from 'zod'
import type { ServiceDeps } from '../../../app.types'
import { invalidField } from '../../../lib/domain-error'
import type { PayrollIncomeType } from '../engine/engine.types'
import { listAllPaymentItems, listDeductionItems } from '../settings/settings.repository'
import * as repo from './cards.repository'
import type { itemsBulkBody } from './cards.schema'
import { assertInputEditable, type CardCaller } from './cards.service'
import type { CardRow, DailyInputData, ItemAmount, WageInputData } from './cards.types'
import { incomeTypeOfSegment, parseBpoSegment, parseJsonColumn, WAGE_INCOME_TYPES } from './cards.utils'

/** Which items a card lists and edits. */
export type CardItemKind = 'payment' | 'deduction'

/**
 * Resolves the `employment_type` parameter into row income types.
 *
 * Accepts a BPO segment (`wage-monthly`) or its underscore form; omitted means every wage segment.
 * Deduction items also apply to daily workers.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for an unknown value.
 */
export function incomeTypesOfEmploymentType(kind: CardItemKind, value: string | undefined): PayrollIncomeType[] {
  if (value === undefined || value === '' || value === 'wage') return kind === 'payment' ? [...WAGE_INCOME_TYPES] : [...WAGE_INCOME_TYPES, 'daily']
  const segment = parseBpoSegment(value.replace('_', '-'))
  if (segment === undefined) throw invalidField('employment_type', 'Unknown employment type.')
  const incomeType = incomeTypeOfSegment(segment)
  if (kind === 'payment' ? !WAGE_INCOME_TYPES.includes(incomeType) : incomeType === 'business' || incomeType === 'other') {
    throw invalidField('employment_type', `The ${segment} segment has no ${kind} items.`)
  }
  return [incomeType]
}

/** Lists a card's items with this month's usage flag and the amount entered on the selected rows. */
export function listCardItems(deps: ServiceDeps, card: CardRow, kind: CardItemKind, employmentType: string | undefined): Record<string, unknown>[] {
  const { db } = deps
  const incomeTypes = incomeTypesOfEmploymentType(kind, employmentType)
  const flags = repo.listCardItemFlags(db, card.id, kind)
  const rows = repo.listRows(db, card.company_id, card.id, incomeTypes)
  const totals = new Map<number, number>()
  for (const row of rows) for (const entry of itemsOf(row.input, kind)) totals.set(entry.item_id, (totals.get(entry.item_id) ?? 0) + entry.amount)
  if (kind === 'payment') {
    return listAllPaymentItems(db, card.company_id)
      .filter((item) => item.is_system === 0)
      .map((item) => ({
        id: item.id,
        name: item.name,
        is_taxable: item.is_taxable === 1,
        non_taxable_category: item.non_taxable_category,
        default_amount: item.default_amount,
        is_enabled: flags.get(item.id) ?? true,
        total_amount: totals.get(item.id) ?? 0,
      }))
  }
  return listDeductionItems(db, card.company_id, 1_000, 0).rows.map((item) => ({
    id: item.id,
    name: item.name,
    amount_mode: item.amount_mode,
    default_amount: item.amount,
    is_enabled: flags.get(item.id) ?? true,
    total_amount: totals.get(item.id) ?? 0,
  }))
}

/**
 * Applies a bulk item edit to a card: usage flags, and amounts on every selected row.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for items the company does not have.
 */
export function bulkUpdateCardItems(deps: ServiceDeps, card: CardRow, kind: CardItemKind, body: z.infer<typeof itemsBulkBody>, caller: CardCaller): void {
  assertInputEditable(card, caller)
  const { db, clock } = deps
  const now = clock.now()
  const known = new Set(
    kind === 'payment' ? listAllPaymentItems(db, card.company_id).map((item) => item.id) : listDeductionItems(db, card.company_id, 1_000, 0).rows.map((item) => item.id),
  )
  const unknown = body.items.filter((item) => !known.has(item.id)).map((item) => item.id)
  if (unknown.length > 0) throw invalidField('items', `Unknown ${kind} items: ${unknown.join(', ')}.`)
  for (const item of body.items) if (item.is_enabled !== undefined) repo.setCardItemFlag(db, card.id, kind, item.id, item.is_enabled, now)
  const amounts = body.items.filter((item) => item.amount !== undefined)
  if (amounts.length === 0) return
  for (const row of repo.listRows(db, card.company_id, card.id, incomeTypesOfEmploymentType(kind, body.employment_type))) {
    const key = kind === 'payment' ? 'payment_items' : 'deduction_items'
    const data = parseJsonColumn<WageInputData | DailyInputData>(row.input, {} as WageInputData)
    const current: ItemAmount[] = [...(((data as unknown as Record<string, unknown>)[key] as ItemAmount[] | undefined) ?? [])]
    for (const item of amounts) {
      const index = current.findIndex((entry) => entry.item_id === item.id)
      const next = { item_id: item.id, amount: item.amount ?? 0 }
      if (index === -1) current.push(next)
      else current[index] = next
    }
    repo.updateRowInput(db, card.company_id, row.id, { ...data, [key]: current } as WageInputData | DailyInputData, now)
  }
}

function itemsOf(input: string, kind: CardItemKind): ItemAmount[] {
  const data = parseJsonColumn<Record<string, unknown>>(input, {})
  const value = data[kind === 'payment' ? 'payment_items' : 'deduction_items']
  return Array.isArray(value) ? (value as ItemAmount[]) : []
}
