/**
 * Legacy payroll cards (`급여 관리`): the compat layer over the same card and row tables BPO uses.
 *
 * Legacy groups the wage segments into `wage-salary` and calls other income
 * `other-labor`; amounts arrive keyed by item ID (`taxable_incomes`,
 * `other_deductions`). Functions run inside the caller's transaction.
 *
 * @module
 */
import type { z } from 'zod'
import type { ServiceDeps } from '../../../app.types'
import { DomainError } from '../../../lib/domain-error'
import { addMonths } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { listEmployeesEmployedBetween } from '../../hr/employees/employees.repository'
import type { PayrollIncomeType } from '../engine/engine.types'
import * as repo from './cards.repository'
import { additionalCardBlocker, assertInputEditable, createCard, type AdditionalCardBlocker, type CardCaller } from './cards.service'
import type { CardRow, ItemAmount, PayrollRowRecord, WageInputData } from './cards.types'
import { isWageIncome, parseJsonColumn, WAGE_INCOME_TYPES } from './cards.utils'
import type { legacyDataBody, legacyPayslipBody } from './legacy.schema'
import { addCandidates, deleteRowsOf, listCandidates, patchWageRows, upsertSimpleRows } from './rows.service'

/** Wage roster changes of a legacy card (`inquire-wage-employees-change`). */
export interface WageRosterChange {
  changed: boolean
  added: { employee_id: number; name: string }[]
  removed: { row_id: number; employee_id: number; name: string }[]
}

/**
 * Creates a legacy default card and fills its wage rows from the HR roster.
 *
 * Production creates these by a monthly batch; this is the extension
 * endpoint (`POST cards`) that stands in for it.
 */
export function createLegacyCard(
  deps: ServiceDeps,
  companyId: string,
  input: { attributionMonth: string; paymentDate?: PlainDate | undefined; name?: string | undefined },
  caller: CardCaller,
): CardRow {
  const card = createCard(deps, companyId, { generation: 'legacy', attributionMonth: input.attributionMonth, paymentDate: input.paymentDate, title: input.name }, caller)
  if (card.kind === 'default') addWageCandidates(deps, card, caller)
  return card
}

/** Creates an additional legacy card from a calculated card of the same month (`additional-card`). */
export function createLegacyAdditionalCard(deps: ServiceDeps, parent: CardRow, caller: CardCaller): CardRow {
  return createCard(deps, parent.company_id, { generation: 'legacy', attributionMonth: parent.attribution_month, parentCardId: parent.id }, caller)
}

/** Reports whether an additional card can be created from a card (`can-create-additional-card`). */
export function additionalCardAvailability(deps: ServiceDeps, card: CardRow): { can_create: boolean; reason: AdditionalCardBlocker | null } {
  const reason = additionalCardBlocker(deps.db, card.company_id, 'legacy', card, card.payment_date, deps.clock.today())
  return { can_create: reason === null, reason }
}

/** Compares a card's wage rows with the HR roster of its period. */
export function wageRosterChange(deps: ServiceDeps, card: CardRow): WageRosterChange {
  const employed = new Set(listEmployeesEmployedBetween(deps.db, card.company_id, card.period_start, card.period_end).map((employee) => employee.id))
  const added = WAGE_INCOME_TYPES.flatMap((incomeType) =>
    card.kind === 'default' ? listCandidates(deps, card, incomeType).map(({ employee }) => ({ employee_id: employee.id, name: employee.name })) : [],
  )
  const removed = repo
    .listRows(deps.db, card.company_id, card.id, WAGE_INCOME_TYPES)
    .flatMap((row) => (row.employee_id !== null && !employed.has(row.employee_id) ? [{ row_id: row.id, employee_id: row.employee_id, name: row.name }] : []))
  return { changed: added.length > 0 || removed.length > 0, added, removed }
}

/** Adds new hires and drops leavers so the wage rows match the HR roster (`refresh-wage-employees-list`). */
export function refreshWageRoster(deps: ServiceDeps, card: CardRow, caller: CardCaller): WageRosterChange {
  assertInputEditable(card, caller)
  const change = wageRosterChange(deps, card)
  if (change.removed.length > 0) deleteRowsOf(deps, card, WAGE_INCOME_TYPES, change.removed.map((row) => row.row_id), caller)
  if (card.kind === 'default') addWageCandidates(deps, card, caller)
  return change
}

/**
 * Saves a legacy card's rows (`POST cards/:c/data`, 임시저장).
 *
 * Wage rows merge `taxable_incomes` and `other_deductions` into the stored
 * item amounts; the other keys create or update rows like BPO's `payroll-input`.
 */
export function saveLegacyData(deps: ServiceDeps, card: CardRow, body: z.infer<typeof legacyDataBody>, caller: CardCaller): void {
  assertInputEditable(card, caller)
  for (const wage of body.wage_salary ?? []) {
    const row = repo.findRow(deps.db, card.company_id, card.id, wage.id)
    if (row === undefined || !isWageIncome(row.income_type)) throw new DomainError('NOT_FOUND', `Wage row ${wage.id} is not on this payroll card.`)
    const data = parseJsonColumn<WageInputData>(row.input, {} as WageInputData)
    patchWageRows(
      deps,
      card,
      row.income_type,
      [
        {
          id: row.id,
          ...(wage.base_pay === undefined ? {} : { base_pay: wage.base_pay }),
          ...(wage.prorate_requested === undefined ? {} : { prorate_requested: wage.prorate_requested }),
          ...(wage.taxable_incomes === undefined ? {} : { payment_items: mergeAmounts(data.payment_items, wage.taxable_incomes) }),
          ...(wage.other_deductions === undefined ? {} : { deduction_items: mergeAmounts(data.deduction_items, wage.other_deductions) }),
          ...(wage.email === undefined ? {} : { email: wage.email }),
        },
      ],
      caller,
    )
  }
  if (body.daily !== undefined && body.daily.length > 0) upsertSimpleRows(deps, card, 'daily', body.daily, caller)
  if (body.business !== undefined && body.business.length > 0) upsertSimpleRows(deps, card, 'business', body.business, caller)
  if (body.other_labor !== undefined && body.other_labor.length > 0) upsertSimpleRows(deps, card, 'other', body.other_labor, caller)
}

/** Serializes a legacy row with the raw `taxable_incomes` and `other_deductions` maps. */
export function legacyAmountsOf(row: PayrollRowRecord): { taxable_incomes: Record<string, number>; other_deductions: Record<string, number> } {
  if (!isWageIncome(row.income_type)) {
    const data = parseJsonColumn<{ deduction_items?: ItemAmount[] }>(row.input, {})
    return { taxable_incomes: {}, other_deductions: amountsMap(data.deduction_items ?? []) }
  }
  const data = parseJsonColumn<WageInputData>(row.input, {} as WageInputData)
  return { taxable_incomes: amountsMap(data.payment_items), other_deductions: amountsMap(data.deduction_items) }
}

/** Finds the previous month's default legacy card a card can copy from (`GET cards/:c/copy`). */
export function copySourceOf(deps: ServiceDeps, card: CardRow): CardRow | undefined {
  const previous = addMonths(`${card.attribution_month}-01` as PlainDate, -1).slice(0, 7)
  return repo.listCards(deps.db, card.company_id, { generation: 'legacy', attributionMonth: previous }).find((candidate) => candidate.kind === 'default')
}

/**
 * Copies the previous month's inputs into a card (`POST cards/:c/copy`).
 *
 * Wage rows take the source's base pay and item amounts by employee, keeping
 * their own proration and work days. Daily, business and other rows are
 * copied as new rows. Every copied row needs calculating again.
 *
 * @returns How many rows were updated and created.
 * @throws {DomainError} `NOT_FOUND` when there is no previous card.
 */
export function copyFromPrevious(deps: ServiceDeps, card: CardRow, caller: CardCaller): { updated: number; created: number } {
  assertInputEditable(card, caller)
  const source = copySourceOf(deps, card)
  if (source === undefined) throw new DomainError('NOT_FOUND', 'There is no payroll card of the previous month to copy.')
  const now = deps.clock.now()
  const targets = repo.listRows(deps.db, card.company_id, card.id)
  let updated = 0
  let created = 0
  for (const row of repo.listRows(deps.db, source.company_id, source.id)) {
    if (isWageIncome(row.income_type)) {
      const target = targets.find((candidate) => candidate.employee_id !== null && candidate.employee_id === row.employee_id && isWageIncome(candidate.income_type))
      if (target === undefined) continue
      const from = parseJsonColumn<WageInputData>(row.input, {} as WageInputData)
      const into = parseJsonColumn<WageInputData>(target.input, {} as WageInputData)
      repo.updateRowInput(
        deps.db,
        card.company_id,
        target.id,
        { ...into, base_pay: from.base_pay, hourly_wage: from.hourly_wage, daily_wage: from.daily_wage, payment_items: from.payment_items, deduction_items: from.deduction_items },
        now,
      )
      updated += 1
      continue
    }
    if (card.kind === 'addition' || targets.some((candidate) => candidate.income_type === row.income_type && candidate.name === row.name)) continue
    repo.insertRow(
      deps.db,
      card.company_id,
      card.id,
      {
        income_type: row.income_type,
        employee_id: row.employee_id,
        name: row.name,
        registration_number_enc: row.registration_number_enc,
        is_foreigner: row.is_foreigner,
        residence_country: row.residence_country,
        payment_date: card.payment_date,
        birth_date: row.birth_date,
        department_name: row.department_name,
        email: row.email,
        employment_status_label: null,
        input: parseJsonColumn(row.input, {} as WageInputData),
        snapshot: parseJsonColumn(row.snapshot, {}),
      },
      now,
    )
    created += 1
  }
  return { updated, created }
}

/** Saves payslip emails and payment formulas of wage rows (`POST cards/:c/payslip`). */
export function saveLegacyPayslips(deps: ServiceDeps, card: CardRow, body: z.infer<typeof legacyPayslipBody>): void {
  const now = deps.clock.now()
  for (const entry of body.wage_salary) {
    const row = repo.findRow(deps.db, card.company_id, card.id, entry.id)
    if (row === undefined || !isWageIncome(row.income_type)) throw new DomainError('NOT_FOUND', `Wage row ${entry.id} is not on this payroll card.`)
    repo.upsertPayslip(deps.db, card.id, row.id, { ...(entry.email === undefined ? {} : { email: entry.email }), ...(entry.payment_formulas === undefined ? {} : { paymentFormulas: entry.payment_formulas }) }, now)
  }
}

/**
 * Loads the payment formulas of the previous closed card, by employee (`copy-payment-formulas`).
 *
 * @returns Formulas keyed by this card's row ID; rows without a match are left out.
 */
export function previousPaymentFormulas(deps: ServiceDeps, card: CardRow): Record<string, Record<string, string>> {
  const previous = repo
    .listCards(deps.db, card.company_id, { generation: card.generation, statuses: ['approved', 'payslips_sent', 'exported'] })
    .find((candidate) => candidate.attribution_month < card.attribution_month)
  if (previous === undefined) return {}
  const payslips = repo.listPayslips(deps.db, previous.id)
  const byEmployee = new Map<number, Record<string, string>>()
  for (const row of repo.listRows(deps.db, previous.company_id, previous.id, WAGE_INCOME_TYPES)) {
    const formulas = parseJsonColumn<Record<string, string>>(payslips.get(row.id)?.payment_formulas ?? null, {})
    if (row.employee_id !== null && Object.keys(formulas).length > 0) byEmployee.set(row.employee_id, formulas)
  }
  const result: Record<string, Record<string, string>> = {}
  for (const row of repo.listRows(deps.db, card.company_id, card.id, WAGE_INCOME_TYPES)) {
    const formulas = row.employee_id === null ? undefined : byEmployee.get(row.employee_id)
    if (formulas !== undefined) result[String(row.id)] = formulas
  }
  return result
}

function addWageCandidates(deps: ServiceDeps, card: CardRow, caller: CardCaller): void {
  for (const incomeType of WAGE_INCOME_TYPES) {
    const ids = listCandidates(deps, card, incomeType).map(({ employee }) => employee.id)
    if (ids.length > 0) addCandidates(deps, card, incomeType as PayrollIncomeType, ids, caller)
  }
}

function mergeAmounts(current: readonly ItemAmount[], raw: Record<string, number>): ItemAmount[] {
  const merged = new Map(current.map((item) => [item.item_id, item.amount]))
  for (const [key, amount] of Object.entries(raw)) merged.set(Number(key), amount)
  return [...merged].map(([item_id, amount]) => ({ item_id, amount }))
}

function amountsMap(items: readonly ItemAmount[]): Record<string, number> {
  return Object.fromEntries(items.map((item) => [String(item.item_id), item.amount]))
}
