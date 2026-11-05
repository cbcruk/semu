import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type {
  DeductionItemRow,
  DeductionSettingsRow,
  PaymentItemFields,
  PaymentItemRow,
  PayrollTermsRow,
  WorkConditionRow,
  WorkSchedulePolicyFields,
  WorkSchedulePolicyRow,
} from './settings.types'

/** A page of rows and the total count. */
export interface RowPage<T> {
  rows: T[]
  count: number
}

/** Filters of the payment item list. */
export interface PaymentItemFilter {
  isTaxable?: boolean
  search?: string
}

/** Inserts the company's `payroll_terms` row when missing; returns whether it was inserted. */
export function insertDefaultTerms(db: DatabaseSync, companyId: string, now: string): boolean {
  return execute(db, 'INSERT OR IGNORE INTO payroll_terms (company_id, updated_at) VALUES (?, ?)', [companyId, now]) === 1
}

/** Inserts the company's `payroll_deduction_settings` row when missing. */
export function insertDefaultDeductionSettings(db: DatabaseSync, companyId: string, now: string): void {
  execute(db, 'INSERT OR IGNORE INTO payroll_deduction_settings (company_id, updated_at) VALUES (?, ?)', [companyId, now])
}

/** Reads the company's payroll terms. */
export function findTerms(db: DatabaseSync, companyId: string): PayrollTermsRow | undefined {
  return queryOne<PayrollTermsRow>(db, 'SELECT * FROM payroll_terms WHERE company_id = ?', [companyId])
}

/** Updates columns of the company's payroll terms. */
export function updateTerms(db: DatabaseSync, companyId: string, patch: Partial<Omit<PayrollTermsRow, 'company_id'>>, now: string): void {
  updateColumns(db, 'payroll_terms', 'company_id = ?', [companyId], { ...patch, updated_at: now })
}

/** Reads the company's deduction settings. */
export function findDeductionSettings(db: DatabaseSync, companyId: string): DeductionSettingsRow | undefined {
  return queryOne<DeductionSettingsRow>(db, 'SELECT * FROM payroll_deduction_settings WHERE company_id = ?', [companyId])
}

/** Updates columns of the company's deduction settings. */
export function updateDeductionSettings(
  db: DatabaseSync,
  companyId: string,
  patch: Partial<Omit<DeductionSettingsRow, 'company_id'>>,
  now: string,
): void {
  updateColumns(db, 'payroll_deduction_settings', 'company_id = ?', [companyId], { ...patch, updated_at: now })
}

/** Lists payment items in display order. */
export function listPaymentItems(db: DatabaseSync, companyId: string, filter: PaymentItemFilter, limit: number, offset: number): RowPage<PaymentItemRow> {
  const where = ['company_id = ?']
  const params: SqlValue[] = [companyId]
  if (filter.isTaxable !== undefined) {
    where.push('is_taxable = ?')
    params.push(filter.isTaxable ? 1 : 0)
  }
  if (filter.search !== undefined && filter.search !== '') {
    where.push("name LIKE ? ESCAPE '\\'")
    params.push(`%${filter.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
  }
  return page<PaymentItemRow>(db, 'payroll_payment_items', where.join(' AND '), params, 'sort_order, id', limit, offset)
}

/** Lists every payment item of a company, for engine inputs. */
export function listAllPaymentItems(db: DatabaseSync, companyId: string): PaymentItemRow[] {
  return queryAll<PaymentItemRow>(db, 'SELECT * FROM payroll_payment_items WHERE company_id = ? ORDER BY sort_order, id', [companyId])
}

/** Finds a payment item within a company. */
export function findPaymentItem(db: DatabaseSync, companyId: string, id: number): PaymentItemRow | undefined {
  return queryOne<PaymentItemRow>(db, 'SELECT * FROM payroll_payment_items WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Finds a payment item by name within a company. */
export function findPaymentItemByName(db: DatabaseSync, companyId: string, name: string): PaymentItemRow | undefined {
  return queryOne<PaymentItemRow>(db, 'SELECT * FROM payroll_payment_items WHERE company_id = ? AND name = ?', [companyId, name])
}

/** Inserts a payment item and returns its ID. */
export function insertPaymentItem(
  db: DatabaseSync,
  companyId: string,
  fields: PaymentItemFields & { non_taxable_category: string | null; is_system: boolean },
  now: string,
): number {
  const next = queryOne<{ next: number }>(db, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM payroll_payment_items WHERE company_id = ?', [companyId])
  const result = db
    .prepare(
      `INSERT INTO payroll_payment_items (company_id, name, source, catalog_code, default_amount, is_taxable, non_taxable_category,
         non_taxable_limit_enabled, non_taxable_limit_amount, include_in_monthly_salary, include_in_ordinary_wage, include_in_average_wage,
         include_in_minimum_wage, show_formula_on_payslip, formula_text, is_system, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      companyId,
      fields.name,
      fields.source,
      fields.catalog_code,
      fields.default_amount,
      bit(fields.is_taxable),
      fields.non_taxable_category,
      bit(fields.non_taxable_limit_enabled),
      fields.non_taxable_limit_amount,
      bit(fields.include_in_monthly_salary),
      bit(fields.include_in_ordinary_wage),
      bit(fields.include_in_average_wage),
      bit(fields.include_in_minimum_wage),
      bit(fields.show_formula_on_payslip),
      fields.formula_text,
      bit(fields.is_system),
      next?.next ?? 1,
      now,
      now,
    )
  return Number(result.lastInsertRowid)
}

/** Replaces the editable columns of a payment item. */
export function updatePaymentItem(
  db: DatabaseSync,
  companyId: string,
  id: number,
  fields: PaymentItemFields & { non_taxable_category: string | null },
  now: string,
): void {
  updateColumns(db, 'payroll_payment_items', 'company_id = ? AND id = ?', [companyId, id], {
    name: fields.name,
    source: fields.source,
    catalog_code: fields.catalog_code,
    default_amount: fields.default_amount,
    is_taxable: bit(fields.is_taxable),
    non_taxable_category: fields.non_taxable_category,
    non_taxable_limit_enabled: bit(fields.non_taxable_limit_enabled),
    non_taxable_limit_amount: fields.non_taxable_limit_amount,
    include_in_monthly_salary: bit(fields.include_in_monthly_salary),
    include_in_ordinary_wage: bit(fields.include_in_ordinary_wage),
    include_in_average_wage: bit(fields.include_in_average_wage),
    include_in_minimum_wage: bit(fields.include_in_minimum_wage),
    show_formula_on_payslip: bit(fields.show_formula_on_payslip),
    formula_text: fields.formula_text,
    updated_at: now,
  })
}

/** Deletes a payment item; returns whether a row was removed. */
export function deletePaymentItem(db: DatabaseSync, companyId: string, id: number): boolean {
  return execute(db, 'DELETE FROM payroll_payment_items WHERE company_id = ? AND id = ?', [companyId, id]) === 1
}

/** Lists deduction items. */
export function listDeductionItems(db: DatabaseSync, companyId: string, limit: number, offset: number): RowPage<DeductionItemRow> {
  return page<DeductionItemRow>(db, 'payroll_deduction_items', 'company_id = ?', [companyId], 'id', limit, offset)
}

/** Finds a deduction item within a company. */
export function findDeductionItem(db: DatabaseSync, companyId: string, id: number): DeductionItemRow | undefined {
  return queryOne<DeductionItemRow>(db, 'SELECT * FROM payroll_deduction_items WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Finds a deduction item by name within a company. */
export function findDeductionItemByName(db: DatabaseSync, companyId: string, name: string): DeductionItemRow | undefined {
  return queryOne<DeductionItemRow>(db, 'SELECT * FROM payroll_deduction_items WHERE company_id = ? AND name = ?', [companyId, name])
}

/** Inserts a deduction item and returns its ID. */
export function insertDeductionItem(
  db: DatabaseSync,
  companyId: string,
  fields: Pick<DeductionItemRow, 'name' | 'amount_mode' | 'amount'>,
  now: string,
): number {
  const result = db
    .prepare('INSERT INTO payroll_deduction_items (company_id, name, amount_mode, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(companyId, fields.name, fields.amount_mode, fields.amount, now, now)
  return Number(result.lastInsertRowid)
}

/** Replaces the editable columns of a deduction item. */
export function updateDeductionItem(
  db: DatabaseSync,
  companyId: string,
  id: number,
  fields: Pick<DeductionItemRow, 'name' | 'amount_mode' | 'amount'>,
  now: string,
): void {
  updateColumns(db, 'payroll_deduction_items', 'company_id = ? AND id = ?', [companyId, id], { ...fields, updated_at: now })
}

/** Deletes a deduction item; returns whether a row was removed. */
export function deleteDeductionItem(db: DatabaseSync, companyId: string, id: number): boolean {
  return execute(db, 'DELETE FROM payroll_deduction_items WHERE company_id = ? AND id = ?', [companyId, id]) === 1
}

/** Lists work conditions, optionally only active or inactive ones. */
export function listWorkConditions(db: DatabaseSync, companyId: string, isActive: boolean | undefined, limit: number, offset: number): RowPage<WorkConditionRow> {
  const [where, params] = activeFilter(companyId, isActive)
  return page<WorkConditionRow>(db, 'work_conditions', where, params, 'id', limit, offset)
}

/** Finds a work condition within a company. */
export function findWorkCondition(db: DatabaseSync, companyId: string, id: number): WorkConditionRow | undefined {
  return queryOne<WorkConditionRow>(db, 'SELECT * FROM work_conditions WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Inserts a work condition and returns its ID. */
export function insertWorkCondition(
  db: DatabaseSync,
  companyId: string,
  fields: Pick<WorkConditionRow, 'name' | 'work_place' | 'probation_months' | 'probation_pay_rate' | 'is_active'>,
  now: string,
): number {
  const result = db
    .prepare(
      `INSERT INTO work_conditions (company_id, name, work_place, probation_months, probation_pay_rate, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(companyId, fields.name, fields.work_place, fields.probation_months, fields.probation_pay_rate, fields.is_active, now, now)
  return Number(result.lastInsertRowid)
}

/** Updates columns of a work condition. */
export function updateWorkCondition(
  db: DatabaseSync,
  companyId: string,
  id: number,
  patch: Partial<Pick<WorkConditionRow, 'name' | 'work_place' | 'probation_months' | 'probation_pay_rate' | 'is_active'>>,
  now: string,
): void {
  updateColumns(db, 'work_conditions', 'company_id = ? AND id = ?', [companyId, id], { ...patch, updated_at: now })
}

/** Deletes a work condition; returns whether a row was removed. */
export function deleteWorkCondition(db: DatabaseSync, companyId: string, id: number): boolean {
  return execute(db, 'DELETE FROM work_conditions WHERE company_id = ? AND id = ?', [companyId, id]) === 1
}

/** Lists work schedule policies, optionally only active or inactive ones. */
export function listWorkSchedulePolicies(
  db: DatabaseSync,
  companyId: string,
  isActive: boolean | undefined,
  limit: number,
  offset: number,
): RowPage<WorkSchedulePolicyRow> {
  const [where, params] = activeFilter(companyId, isActive)
  return page<WorkSchedulePolicyRow>(db, 'work_schedule_policies', where, params, 'id', limit, offset)
}

/** Finds a work schedule policy within a company. */
export function findWorkSchedulePolicy(db: DatabaseSync, companyId: string, id: number): WorkSchedulePolicyRow | undefined {
  return queryOne<WorkSchedulePolicyRow>(db, 'SELECT * FROM work_schedule_policies WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Inserts a work schedule policy and returns its ID. */
export function insertWorkSchedulePolicy(db: DatabaseSync, companyId: string, fields: WorkSchedulePolicyFields, now: string): number {
  const columns = policyColumns(fields)
  const result = db
    .prepare(
      `INSERT INTO work_schedule_policies (company_id, name, paid_weekly_holidays, unpaid_holidays, contractual_work_schedule_type,
         contractual_work_schedules, weekly_rest_hours_input_method, weekly_rest_hours_x100, fixed_overtime_work_schedule_type,
         fixed_overtime_input_type, fixed_overtime_items, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      companyId,
      columns.name,
      columns.paid_weekly_holidays,
      columns.unpaid_holidays,
      columns.contractual_work_schedule_type,
      columns.contractual_work_schedules,
      columns.weekly_rest_hours_input_method,
      columns.weekly_rest_hours_x100,
      columns.fixed_overtime_work_schedule_type,
      columns.fixed_overtime_input_type,
      columns.fixed_overtime_items,
      columns.is_active,
      now,
      now,
    )
  return Number(result.lastInsertRowid)
}

/** Replaces a work schedule policy. */
export function replaceWorkSchedulePolicy(db: DatabaseSync, companyId: string, id: number, fields: WorkSchedulePolicyFields, now: string): void {
  updateColumns(db, 'work_schedule_policies', 'company_id = ? AND id = ?', [companyId, id], { ...policyColumns(fields), updated_at: now })
}

/** Sets whether a work schedule policy is active. */
export function setWorkSchedulePolicyActive(db: DatabaseSync, companyId: string, id: number, isActive: boolean, now: string): void {
  updateColumns(db, 'work_schedule_policies', 'company_id = ? AND id = ?', [companyId, id], { is_active: bit(isActive), updated_at: now })
}

/** Deletes a work schedule policy; returns whether a row was removed. */
export function deleteWorkSchedulePolicy(db: DatabaseSync, companyId: string, id: number): boolean {
  return execute(db, 'DELETE FROM work_schedule_policies WHERE company_id = ? AND id = ?', [companyId, id]) === 1
}

function policyColumns(fields: WorkSchedulePolicyFields): Omit<WorkSchedulePolicyRow, 'id' | 'company_id' | 'created_at' | 'updated_at'> {
  return {
    name: fields.name,
    paid_weekly_holidays: JSON.stringify(fields.paid_weekly_holidays),
    unpaid_holidays: JSON.stringify(fields.unpaid_holidays),
    contractual_work_schedule_type: fields.contractual_work_schedule_type,
    contractual_work_schedules: JSON.stringify(fields.contractual_work_schedules),
    weekly_rest_hours_input_method: fields.weekly_rest_hours_input_method,
    weekly_rest_hours_x100: fields.weekly_rest_hours === null ? null : Math.round(fields.weekly_rest_hours * 100),
    fixed_overtime_work_schedule_type: fields.fixed_overtime_work_schedule_type,
    fixed_overtime_input_type: fields.fixed_overtime_input_type,
    fixed_overtime_items: JSON.stringify(fields.fixed_overtime_items),
    is_active: bit(fields.is_active),
  }
}

function activeFilter(companyId: string, isActive: boolean | undefined): [string, SqlValue[]] {
  return isActive === undefined ? ['company_id = ?', [companyId]] : ['company_id = ? AND is_active = ?', [companyId, bit(isActive)]]
}

function page<T>(db: DatabaseSync, table: string, where: string, params: SqlValue[], orderBy: string, limit: number, offset: number): RowPage<T> {
  const count = queryOne<{ count: number }>(db, `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`, params)?.count ?? 0
  const rows = queryAll<T>(db, `SELECT * FROM ${table} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, limit, offset])
  return { rows, count }
}

function updateColumns(db: DatabaseSync, table: string, where: string, whereParams: SqlValue[], values: Record<string, SqlValue | undefined>): void {
  const entries = Object.entries(values).filter((entry): entry is [string, SqlValue] => entry[1] !== undefined)
  if (entries.length === 0) return
  const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
  execute(db, `UPDATE ${table} SET ${assignments} WHERE ${where}`, [...entries.map(([, value]) => value), ...whereParams])
}

function bit(value: boolean): 0 | 1 {
  return value ? 1 : 0
}
