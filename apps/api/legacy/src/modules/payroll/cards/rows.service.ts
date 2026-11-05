/**
 * Payroll card rows: candidates, inputs, work sheets, calculation, reset, HR refresh and deletion.
 *
 * Functions run inside the caller's transaction.
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import type { ServiceDeps } from '../../../app.types'
import { invalidField, notFound } from '../../../lib/domain-error'
import { findEmployee, listEmployees, listEmployeesEmployedBetween } from '../../hr/employees/employees.repository'
import type { EmployeeRecord } from '../../hr/employees/employees.types'
import type { PayrollIncomeType } from '../engine/engine.types'
import { PayrollError } from '../payroll-error'
import * as repo from './cards.repository'
import type { overridesSchema, simpleRowSchema, wageRowPatchSchema, workInputBody } from './cards.schema'
import { assertInputEditable, assertRecalculable, type CardCaller } from './cards.service'
import type {
  BusinessInputData,
  CardRow,
  DailyInputData,
  OtherInputData,
  PayrollRowRecord,
  RowOverrides,
  WageInputData,
} from './cards.types'
import { EMPTY_WORK, isWageIncome, parseJsonColumn } from './cards.utils'
import { emptySimpleInput, personalOf, prorationOf, simpleRowOf, snapshotOf, statusLabelOf, wageIncomeTypeOf, wageRowOf } from './employee-source'
import { calculateStoredRow, loadCalculationContext } from './row-calculation'

type WageRowPatch = z.infer<typeof wageRowPatchSchema>
type SimpleRowInput = z.infer<typeof simpleRowSchema>
type WorkInputRows = z.infer<typeof workInputBody>['rows']

/** An employee that can be added to a card segment. */
export interface Candidate {
  employee: EmployeeRecord
  incomeType: PayrollIncomeType
}

/**
 * Lists the employees that can be added to a segment of a card (`payroll-input/candidates`).
 *
 * Wage segments offer wage employees employed during the card's period whose
 * payroll contract has the segment's pay unit; the other segments offer HR's
 * daily, business or other income earners. Employees already on the card are left out.
 */
export function listCandidates(deps: ServiceDeps, card: CardRow, incomeType: PayrollIncomeType): Candidate[] {
  const { db, cipher } = deps
  const present = new Set(repo.listRows(db, card.company_id, card.id).flatMap((row) => (row.employee_id === null ? [] : [row.employee_id])))
  if (isWageIncome(incomeType)) {
    return listEmployeesEmployedBetween(db, card.company_id, card.period_start, card.period_end)
      .filter((employee) => !present.has(employee.id))
      .map((employee) => ({ employee, incomeType: wageIncomeTypeOf(db, cipher, card.company_id, employee.id, card.period_end) }))
      .filter((candidate) => candidate.incomeType === incomeType)
  }
  return listEmployees(db, card.company_id, deps.clock.today(), [incomeType as 'daily' | 'business' | 'other'])
    .filter((employee) => !present.has(employee.id))
    .map((employee) => ({ employee, incomeType }))
}

/**
 * Adds employees to a segment of a card, filling the rows from HR.
 *
 * @throws {PayrollError} `WAGE_INCOME_ON_ADDITIONAL_CARD` for wage segments of an additional card.
 * @throws {DomainError} `VALIDATION_FAILED` for employees that are not candidates.
 */
export function addCandidates(deps: ServiceDeps, card: CardRow, incomeType: PayrollIncomeType, employeeIds: readonly number[], caller: CardCaller): number[] {
  assertInputEditable(card, caller)
  assertSegmentAllowed(card, incomeType)
  const candidates = new Map(listCandidates(deps, card, incomeType).map((candidate) => [candidate.employee.id, candidate]))
  const missing = employeeIds.filter((employeeId) => !candidates.has(employeeId))
  if (missing.length > 0) throw invalidField('employee_ids', `Employees ${missing.join(', ')} cannot be added to this segment.`)
  const now = deps.clock.now()
  return employeeIds.map((employeeId) => {
    const candidate = candidates.get(employeeId)
    if (candidate === undefined) throw notFound('Employee')
    const write = isWageIncome(incomeType)
      ? wageRowOf(deps.db, deps.cipher, card, candidate.employee, incomeType)
      : simpleRowOf(card, candidate.employee, incomeType as 'daily' | 'business' | 'other')
    return repo.insertRow(deps.db, card.company_id, card.id, write, now)
  })
}

/**
 * Applies wage row edits (`PUT payroll-input/:r`, `payroll-input/update`).
 *
 * Omitted fields keep their values, `work` and `insurance_notice` merge
 * field by field, and `overrides` replaces the manual amounts. Edits clear
 * the row's calculation until it is calculated again.
 */
export function patchWageRows(deps: ServiceDeps, card: CardRow, incomeType: PayrollIncomeType, rows: readonly (WageRowPatch & { id: number })[], caller: CardCaller): void {
  assertInputEditable(card, caller)
  const now = deps.clock.now()
  for (const patch of rows) {
    const row = requireRow(deps.db, card, patch.id, [incomeType])
    const data = parseJsonColumn<WageInputData>(row.input, {} as WageInputData)
    const next: WageInputData = {
      ...data,
      ...definedOf({
        base_pay: patch.base_pay,
        hourly_wage: patch.hourly_wage,
        daily_wage: patch.daily_wage,
        worked_days: patch.worked_days,
        prorate_requested: patch.prorate_requested,
        payment_items: patch.payment_items,
        deduction_items: patch.deduction_items,
      }),
      ...(patch.proration === undefined ? {} : { proration: patch.proration }),
      work: { ...EMPTY_WORK, ...data.work, ...definedOf(patch.work ?? {}) },
      insurance_notice: { ...data.insurance_notice, ...definedOf(patch.insurance_notice ?? {}) },
    }
    repo.updateRowInput(deps.db, card.company_id, row.id, next, now)
    if (patch.email !== undefined) repo.updateRowPersonal(deps.db, card.company_id, row.id, { email: patch.email }, now)
    if (patch.overrides !== undefined) repo.updateRowOverrides(deps.db, card.company_id, row.id, overridesOf(patch.overrides), now)
  }
}

/**
 * Creates or updates daily, business and other income rows (`POST payroll-input`).
 *
 * Rows with an `id` are updated field by field; rows without one are
 * created and need a `name` unless they name an HR `employee_id`.
 * Registration numbers are stored encrypted.
 *
 * @returns The IDs of the rows in request order.
 */
export function upsertSimpleRows(deps: ServiceDeps, card: CardRow, incomeType: 'daily' | 'business' | 'other', rows: readonly SimpleRowInput[], caller: CardCaller): number[] {
  assertInputEditable(card, caller)
  const { db, cipher, clock } = deps
  const now = clock.now()
  return rows.map((body, index) => {
    let row: PayrollRowRecord | undefined
    if (body.id === undefined) {
      const employee = body.employee_id == null ? undefined : findEmployee(db, card.company_id, body.employee_id, clock.today())
      if (body.employee_id != null && employee === undefined) throw invalidField(`rows.${index}.employee_id`, 'Employee not found.')
      if (employee === undefined && body.name === undefined) throw invalidField(`rows.${index}.name`, 'Name is required for a new row.')
      const base = employee === undefined ? undefined : simpleRowOf(card, employee, incomeType)
      const id = repo.insertRow(
        db,
        card.company_id,
        card.id,
        base ?? {
          income_type: incomeType,
          employee_id: null,
          name: body.name ?? '',
          registration_number_enc: null,
          is_foreigner: 0,
          residence_country: 'KR',
          payment_date: card.payment_date,
          birth_date: null,
          department_name: null,
          email: null,
          employment_status_label: null,
          input: emptySimpleInput(incomeType),
          snapshot: {},
        },
        now,
      )
      row = repo.findRow(db, card.company_id, card.id, id)
    } else {
      row = requireRow(db, card, body.id, [incomeType])
    }
    if (row === undefined) throw notFound('Payroll row')
    repo.updateRowPersonal(
      db,
      card.company_id,
      row.id,
      definedOf({
        name: body.name,
        registration_number_enc: body.resident_number === undefined ? undefined : body.resident_number === null ? null : cipher.encrypt(body.resident_number.replaceAll('-', '')),
        is_foreigner: body.is_foreigner === undefined ? undefined : body.is_foreigner ? (1 as const) : (0 as const),
        residence_country: body.residence_country,
        payment_date: body.payment_date,
        email: body.email,
      }),
      now,
    )
    repo.updateRowInput(db, card.company_id, row.id, mergeSimpleInput(incomeType, row, body), now)
    if (body.overrides !== undefined) repo.updateRowOverrides(db, card.company_id, row.id, overridesOf(body.overrides), now)
    return row.id
  })
}

/**
 * Calculates rows of a segment with the engine and stores the results.
 *
 * Without `ids` every row of the segment is calculated.
 *
 * @throws {PayrollError} `WITHHOLDING_FILED` when the payment month's return is filed.
 */
export function calculateRows(deps: ServiceDeps, card: CardRow, incomeTypes: readonly PayrollIncomeType[], ids: readonly number[] | undefined, caller: CardCaller): PayrollRowRecord[] {
  assertInputEditable(card, caller)
  assertRecalculable(deps.db, card)
  const rows = selectRows(deps.db, card, incomeTypes, ids)
  const context = loadCalculationContext(deps.db, card)
  const now = deps.clock.now()
  for (const row of rows) repo.saveRowResult(deps.db, card.company_id, row.id, calculateStoredRow(row, context), now)
  return rows.map((row) => requireRow(deps.db, card, row.id, incomeTypes))
}

/** Clears manual overrides and recalculates (`reset-calculation`). */
export function resetRows(deps: ServiceDeps, card: CardRow, incomeTypes: readonly PayrollIncomeType[], ids: readonly number[] | undefined, caller: CardCaller): PayrollRowRecord[] {
  assertInputEditable(card, caller)
  assertRecalculable(deps.db, card)
  const now = deps.clock.now()
  for (const row of selectRows(deps.db, card, incomeTypes, ids)) repo.updateRowOverrides(deps.db, card.company_id, row.id, {}, now)
  return calculateRows(deps, card, incomeTypes, ids, caller)
}

/**
 * Re-reads HR data of wage rows (`refresh-employee-info`, 구성원 정보 동기화).
 *
 * Personal data, the status label, proration and the deduction snapshot are
 * refreshed; work, payment and deduction values stay as entered.
 */
export function refreshRows(deps: ServiceDeps, card: CardRow, incomeTypes: readonly PayrollIncomeType[], ids: readonly number[] | undefined, caller: CardCaller): void {
  assertInputEditable(card, caller)
  assertRecalculable(deps.db, card)
  const { db, clock } = deps
  const now = clock.now()
  for (const row of selectRows(db, card, incomeTypes, ids)) {
    if (row.employee_id === null) continue
    const employee = findEmployee(db, card.company_id, row.employee_id, card.period_end)
    if (employee === undefined) continue
    const { employee_id: _employeeId, registration_number_enc: _registration, ...personal } = personalOf(employee, row.payment_date ?? card.payment_date)
    repo.updateRowPersonal(db, card.company_id, row.id, { ...personal, employment_status_label: isWageIncome(row.income_type) ? statusLabelOf(db, card, employee) : null }, now)
    if (!isWageIncome(row.income_type)) continue
    repo.updateRowSnapshot(db, card.company_id, row.id, snapshotOf(db, card.company_id, employee.id, card.period_end), now)
    const data = parseJsonColumn<WageInputData>(row.input, {} as WageInputData)
    const proration = prorationOf(db, card, employee)
    repo.updateRowInput(db, card.company_id, row.id, { ...data, proration, prorate_requested: proration !== null }, now)
  }
}

/** Deletes rows of a segment (`payroll-input/delete`). */
export function deleteRowsOf(deps: ServiceDeps, card: CardRow, incomeTypes: readonly PayrollIncomeType[], ids: readonly number[], caller: CardCaller): number {
  assertInputEditable(card, caller)
  const owned = selectRows(deps.db, card, incomeTypes, ids).map((row) => row.id)
  return repo.deleteRows(deps.db, card.company_id, card.id, owned)
}

/** Saves a segment's work sheet (`POST work-input`). */
export function saveWorkSheet(deps: ServiceDeps, card: CardRow, incomeType: PayrollIncomeType, rows: WorkInputRows, caller: CardCaller): void {
  assertInputEditable(card, caller)
  const now = deps.clock.now()
  for (const entry of rows) {
    const row = requireRow(deps.db, card, entry.id, [incomeType])
    const { id: _id, worked_days: workedDays, work_dates: workDates, avg_daily_hours: avgHours, ...work } = entry
    if (incomeType === 'daily') {
      const data = parseJsonColumn<DailyInputData>(row.input, {} as DailyInputData)
      repo.updateRowInput(deps.db, card.company_id, row.id, { ...data, ...definedOf({ work_dates: workDates, avg_daily_hours: avgHours }) }, now)
      continue
    }
    const data = parseJsonColumn<WageInputData>(row.input, {} as WageInputData)
    repo.updateRowInput(
      deps.db,
      card.company_id,
      row.id,
      { ...data, ...definedOf({ worked_days: workedDays }), work: { ...EMPTY_WORK, ...data.work, ...definedOf(work) } },
      now,
    )
  }
}

/**
 * Rejects wage segments on an additional card, which only carries daily, business and other income (spec 1.4).
 *
 * @throws {PayrollError} `WAGE_INCOME_ON_ADDITIONAL_CARD`.
 */
export function assertSegmentAllowed(card: CardRow, incomeType: PayrollIncomeType): void {
  if (card.kind === 'addition' && isWageIncome(incomeType)) {
    throw new PayrollError('WAGE_INCOME_ON_ADDITIONAL_CARD', 'Wage income is entered on the default payroll card of the month only.')
  }
}

/**
 * Finds a row of a card within some income types.
 *
 * @throws {DomainError} `NOT_FOUND`.
 */
export function requireRow(db: DatabaseSync, card: CardRow, rowId: number, incomeTypes: readonly PayrollIncomeType[]): PayrollRowRecord {
  const row = repo.findRow(db, card.company_id, card.id, rowId)
  if (row === undefined || !incomeTypes.includes(row.income_type)) throw notFound('Payroll row')
  return row
}

function selectRows(db: DatabaseSync, card: CardRow, incomeTypes: readonly PayrollIncomeType[], ids: readonly number[] | undefined): PayrollRowRecord[] {
  const rows = repo.listRows(db, card.company_id, card.id, incomeTypes)
  if (ids === undefined || ids.length === 0) return rows
  const wanted = new Set(ids)
  const selected = rows.filter((row) => wanted.has(row.id))
  if (selected.length !== wanted.size) throw notFound('Payroll row')
  return selected
}

function mergeSimpleInput(incomeType: 'daily' | 'business' | 'other', row: PayrollRowRecord, body: SimpleRowInput): DailyInputData | BusinessInputData | OtherInputData {
  if (incomeType === 'daily') {
    const data = parseJsonColumn<DailyInputData>(row.input, emptySimpleInput('daily') as DailyInputData)
    return {
      ...data,
      ...definedOf({
        pay_amount: body.pay_amount,
        work_dates: body.work_dates,
        work_days: body.work_days,
        avg_daily_hours: body.avg_daily_hours,
        is_owner_or_cohabiting_relative: body.is_owner_or_cohabiting_relative,
        deduction_items: body.deduction_items,
      }),
    }
  }
  if (incomeType === 'business') {
    const data = parseJsonColumn<BusinessInputData>(row.input, emptySimpleInput('business') as BusinessInputData)
    return {
      ...data,
      ...definedOf({
        pay_amount: body.pay_amount,
        business_income_type_code: body.business_income_type_code,
        detail_type: body.detail_type,
        employment_insurance_applicable: body.employment_insurance_applicable,
        contract_type: body.contract_type,
        short_term_work_dates: body.short_term_work_dates,
        special_occ_type_code: body.special_occ_type_code,
        tax_deduction_mode: body.tax_deduction_mode,
      }),
    }
  }
  const data = parseJsonColumn<OtherInputData>(row.input, emptySimpleInput('other') as OtherInputData)
  return {
    ...data,
    ...definedOf({
      pay_amount: body.pay_amount,
      other_income_type_code: body.other_income_type_code,
      tax_deduction_mode: body.tax_deduction_mode,
      necessary_expense_amount: body.necessary_expense_amount,
    }),
  }
}

function overridesOf(body: z.infer<typeof overridesSchema>): RowOverrides {
  const overrides: RowOverrides = {}
  for (const [key, value] of Object.entries(body)) if (typeof value === 'number') overrides[key as keyof RowOverrides] = value
  return overrides
}

function definedOf<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> }
}
