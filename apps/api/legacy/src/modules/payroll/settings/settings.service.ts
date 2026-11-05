import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { DomainError, notFound } from '../../../lib/domain-error'
import { formatWon } from '../engine/engine.utils'
import type { PayrollRateTable } from '../engine/rate-table.types'
import { MULTIPLIERS_FIVE_OR_MORE, MULTIPLIERS_UNDER_FIVE } from '../engine/working-time'
import { DEFAULT_PAYMENT_ITEM_CODES, findCatalogItem, PAYMENT_CATALOG } from './payment-catalog'
import * as repo from './settings.repository'
import type {
  deductionItemCreateBody,
  deductionItemPatchBody,
  deductionSettingsBody,
  paymentItemCreateBody,
  paymentItemPatchBody,
  payrollTermsBody,
  workConditionCreateBody,
  workConditionPatchBody,
  workSchedulePolicyBody,
} from './settings.schema'
import type {
  DeductionItemRow,
  PaymentCatalogItem,
  PaymentItemFields,
  PaymentItemRow,
  PayrollTermsRow,
  SettingsUsageCounter,
  WorkSchedulePolicyFields,
} from './settings.types'
import { scheduleHours, toX100 } from './settings.utils'

type FieldErrors = Record<string, string[]>

/** Default work schedule policy created for every company: Monday to Friday, 8 hours a day, Sunday paid rest. */
export const DEFAULT_WORK_SCHEDULE_POLICY: WorkSchedulePolicyFields = {
  name: '주 5일 40시간',
  paid_weekly_holidays: [6],
  unpaid_holidays: [5],
  contractual_work_schedule_type: 'weekly',
  contractual_work_schedules: [0, 1, 2, 3, 4].map((day) => ({ week: 1, day_of_week: day, hours: 8 })),
  weekly_rest_hours_input_method: 'auto_calculated',
  weekly_rest_hours: null,
  fixed_overtime_work_schedule_type: 'none',
  fixed_overtime_input_type: 'none',
  fixed_overtime_items: [],
  is_active: true,
}

/** Counter used until employees reference settings: every setting has zero usages. */
export const NO_USAGE: SettingsUsageCounter = {
  workConditionUsages: () => 0,
  workSchedulePolicyUsages: () => 0,
}

/**
 * Creates a company's payroll settings on first use: terms, deduction settings, default payment items, a work condition and a work schedule policy.
 *
 * Does nothing when the terms row already exists. Runs inside the caller's
 * transaction, so the seed and request handlers can share it.
 */
export function ensurePayrollSettings(db: DatabaseSync, companyId: string, now: string): void {
  if (!repo.insertDefaultTerms(db, companyId, now)) return
  repo.insertDefaultDeductionSettings(db, companyId, now)
  for (const code of DEFAULT_PAYMENT_ITEM_CODES) {
    const catalog = findCatalogItem(code)
    if (catalog === undefined) continue
    repo.insertPaymentItem(db, companyId, { ...catalogFields(catalog), non_taxable_category: catalog.nonTaxableCategory, is_system: code === 'base_pay' }, now)
  }
  repo.insertWorkCondition(db, companyId, { name: '기본 근로조건', work_place: '', probation_months: 0, probation_pay_rate: 100, is_active: 1 }, now)
  repo.insertWorkSchedulePolicy(db, companyId, DEFAULT_WORK_SCHEDULE_POLICY, now)
}

/** Lists catalog items matching the filters of the "항목 불러오기" modal. */
export function searchCatalog(filter: { search?: string; is_taxable?: boolean; group?: string }): PaymentCatalogItem[] {
  return PAYMENT_CATALOG.filter(
    (entry) =>
      (filter.search === undefined || entry.name.includes(filter.search)) &&
      (filter.is_taxable === undefined || entry.isTaxable === filter.is_taxable) &&
      (filter.group === undefined || entry.group === filter.group),
  )
}

/**
 * Creates a payment item, filling unset fields from its catalog entry.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when the item breaks a payment item rule.
 */
export function createPaymentItem(
  db: DatabaseSync,
  companyId: string,
  body: z.infer<typeof paymentItemCreateBody>,
  rates: PayrollRateTable,
  now: string,
): PaymentItemRow {
  const catalog = body.source === 'catalog' && body.catalog_code != null ? findCatalogItem(body.catalog_code) : undefined
  const base: PaymentItemFields =
    catalog === undefined
      ? {
          ...catalogFields(undefined),
          name: body.name,
          source: body.source,
          catalog_code: body.catalog_code ?? null,
        }
      : catalogFields(catalog)
  const fields = { ...base, ...defined(body) }
  const category = validatePaymentItem(db, companyId, fields, undefined, rates)
  const id = repo.insertPaymentItem(db, companyId, { ...normalize(fields), non_taxable_category: category, is_system: false }, now)
  return requirePaymentItem(db, companyId, id)
}

/**
 * Updates a payment item; system items keep their name, source and taxability.
 *
 * @throws {DomainError} `NOT_FOUND`, or `VALIDATION_FAILED` when the result breaks a payment item rule.
 */
export function updatePaymentItem(
  db: DatabaseSync,
  companyId: string,
  id: number,
  body: z.infer<typeof paymentItemPatchBody>,
  rates: PayrollRateTable,
  now: string,
): PaymentItemRow {
  const existing = requirePaymentItem(db, companyId, id)
  const fields = { ...paymentItemFieldsOf(existing), ...defined(body) }
  const category = validatePaymentItem(db, companyId, fields, existing, rates)
  repo.updatePaymentItem(db, companyId, id, { ...normalize(fields), non_taxable_category: category }, now)
  return requirePaymentItem(db, companyId, id)
}

/**
 * Deletes a payment item.
 *
 * @throws {DomainError} `NOT_FOUND`, or `INVALID_TRANSITION` for the system base pay item.
 */
export function removePaymentItem(db: DatabaseSync, companyId: string, id: number): void {
  const existing = requirePaymentItem(db, companyId, id)
  if (existing.is_system === 1) throw new DomainError('INVALID_TRANSITION', 'System payment items cannot be deleted.')
  repo.deletePaymentItem(db, companyId, id)
}

/** Reads a payment item or throws `NOT_FOUND`. */
export function requirePaymentItem(db: DatabaseSync, companyId: string, id: number): PaymentItemRow {
  const row = repo.findPaymentItem(db, companyId, id)
  if (row === undefined) throw notFound('Payment item')
  return row
}

/** Applies a partial update to the company's deduction settings. */
export function patchDeductionSettings(db: DatabaseSync, companyId: string, body: z.infer<typeof deductionSettingsBody>, now: string): void {
  const { national_pension_pay_on_acquisition_month: acquisition, ...methods } = body
  repo.updateDeductionSettings(
    db,
    companyId,
    { ...defined(methods), ...(acquisition === undefined ? {} : { national_pension_pay_on_acquisition_month: acquisition ? 1 : 0 }) },
    now,
  )
}

/**
 * Creates a deduction item.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when the name is taken or a fixed item has no amount.
 */
export function createDeductionItem(db: DatabaseSync, companyId: string, body: z.infer<typeof deductionItemCreateBody>, now: string): DeductionItemRow {
  const fields = validateDeductionItem(db, companyId, { name: body.name, amount_mode: body.amount_mode, amount: body.amount ?? null }, undefined)
  return requireDeductionItem(db, companyId, repo.insertDeductionItem(db, companyId, fields, now))
}

/**
 * Updates a deduction item.
 *
 * @throws {DomainError} `NOT_FOUND`, or `VALIDATION_FAILED` like {@linkcode createDeductionItem}.
 */
export function updateDeductionItem(
  db: DatabaseSync,
  companyId: string,
  id: number,
  body: z.infer<typeof deductionItemPatchBody>,
  now: string,
): DeductionItemRow {
  const existing = requireDeductionItem(db, companyId, id)
  const merged = { name: existing.name, amount_mode: existing.amount_mode, amount: existing.amount, ...defined(body) }
  const fields = validateDeductionItem(db, companyId, merged, existing)
  repo.updateDeductionItem(db, companyId, id, fields, now)
  return requireDeductionItem(db, companyId, id)
}

/** Reads a deduction item or throws `NOT_FOUND`. */
export function requireDeductionItem(db: DatabaseSync, companyId: string, id: number): DeductionItemRow {
  const row = repo.findDeductionItem(db, companyId, id)
  if (row === undefined) throw notFound('Deduction item')
  return row
}

/**
 * Applies a partial update to payroll terms.
 *
 * Switching `is_under_five_employees` without sending multipliers resets them
 * to the defaults of the new size (5인 이상 1.5/0.5/1.5/2, 5인 미만 1/0/1/1).
 */
export function patchPayrollTerms(db: DatabaseSync, companyId: string, body: z.infer<typeof payrollTermsBody>, now: string): void {
  const current = repo.findTerms(db, companyId)
  const patch: Partial<Omit<PayrollTermsRow, 'company_id'>> = {
    wage_period_start_day: body.wage_period_start_day,
    payment_month: body.payment_month,
    payment_day: body.payment_day,
    payment_method: body.payment_method,
    attendance_record_integration: body.attendance_record_integration,
    retirement_benefit_type: body.retirement_benefit_type,
  }
  if (body.is_under_five_employees !== undefined) {
    patch.is_under_five_employees = body.is_under_five_employees ? 1 : 0
    if (current !== undefined && current.is_under_five_employees !== patch.is_under_five_employees) {
      const defaults = body.is_under_five_employees ? MULTIPLIERS_UNDER_FIVE : MULTIPLIERS_FIVE_OR_MORE
      patch.fixed_overtime_multiplier_x100 = toX100(defaults.overtime)
      patch.fixed_night_multiplier_x100 = toX100(defaults.night)
      patch.fixed_holiday_multiplier_x100 = toX100(defaults.holiday)
      patch.fixed_holiday_overtime_multiplier_x100 = toX100(defaults.holidayOvertime)
    }
  }
  if (body.fixed_overtime_multiplier !== undefined) patch.fixed_overtime_multiplier_x100 = toX100(body.fixed_overtime_multiplier)
  if (body.fixed_night_multiplier !== undefined) patch.fixed_night_multiplier_x100 = toX100(body.fixed_night_multiplier)
  if (body.fixed_holiday_multiplier !== undefined) patch.fixed_holiday_multiplier_x100 = toX100(body.fixed_holiday_multiplier)
  if (body.fixed_holiday_overtime_multiplier !== undefined) {
    patch.fixed_holiday_overtime_multiplier_x100 = toX100(body.fixed_holiday_overtime_multiplier)
  }
  repo.updateTerms(db, companyId, patch, now)
}

/** Creates a work condition; without probation the probation pay rate is 100%. */
export function createWorkCondition(db: DatabaseSync, companyId: string, body: z.infer<typeof workConditionCreateBody>, now: string): number {
  const months = body.probation_months ?? 0
  return repo.insertWorkCondition(
    db,
    companyId,
    {
      name: body.name,
      work_place: body.work_place ?? '',
      probation_months: months,
      probation_pay_rate: months === 0 ? 100 : (body.probation_pay_rate ?? 100),
      is_active: body.is_active === false ? 0 : 1,
    },
    now,
  )
}

/**
 * Updates a work condition.
 *
 * @throws {DomainError} `NOT_FOUND` when it does not belong to the company.
 */
export function updateWorkCondition(db: DatabaseSync, companyId: string, id: number, body: z.infer<typeof workConditionPatchBody>, now: string): void {
  const existing = repo.findWorkCondition(db, companyId, id)
  if (existing === undefined) throw notFound('Work condition')
  const months = body.probation_months ?? existing.probation_months
  repo.updateWorkCondition(
    db,
    companyId,
    id,
    {
      name: body.name,
      work_place: body.work_place,
      probation_months: body.probation_months,
      probation_pay_rate: months === 0 ? 100 : body.probation_pay_rate,
      is_active: body.is_active === undefined ? undefined : body.is_active ? 1 : 0,
    },
    now,
  )
}

/**
 * Deletes a work condition that no employee uses.
 *
 * @throws {DomainError} `NOT_FOUND`, or `INVALID_TRANSITION` while it is in use.
 */
export function removeWorkCondition(db: DatabaseSync, companyId: string, id: number, usage: SettingsUsageCounter): void {
  if (repo.findWorkCondition(db, companyId, id) === undefined) throw notFound('Work condition')
  if (usage.workConditionUsages(companyId, id) > 0) throw new DomainError('INVALID_TRANSITION', 'The work condition is in use. Deactivate it instead.')
  repo.deleteWorkCondition(db, companyId, id)
}

/**
 * Validates a work schedule policy and fills the automatic weekly rest hours.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when holidays overlap, a scheduled day is a holiday,
 *   a week is outside the cycle, or the fixed overtime fields disagree.
 */
export function validateWorkSchedulePolicy(body: z.infer<typeof workSchedulePolicyBody>): WorkSchedulePolicyFields {
  const errors: FieldErrors = {}
  const fields: WorkSchedulePolicyFields = {
    name: body.name,
    paid_weekly_holidays: [...new Set(body.paid_weekly_holidays)].sort(),
    unpaid_holidays: [...new Set(body.unpaid_holidays)].sort(),
    contractual_work_schedule_type: body.contractual_work_schedule_type,
    contractual_work_schedules: body.contractual_work_schedules,
    weekly_rest_hours_input_method: body.weekly_rest_hours_input_method,
    weekly_rest_hours: body.weekly_rest_hours_input_method === 'manual' ? (body.weekly_rest_hours ?? null) : null,
    fixed_overtime_work_schedule_type: body.fixed_overtime_work_schedule_type,
    fixed_overtime_input_type: body.fixed_overtime_input_type,
    fixed_overtime_items: (body.fixed_overtime_items ?? []).map((item) => ({ work_type: item.work_type, day_of_week: item.day_of_week ?? null, hours: item.hours })),
    is_active: body.is_active ?? true,
  }
  if (fields.paid_weekly_holidays.some((day) => fields.unpaid_holidays.includes(day))) {
    add(errors, 'unpaid_holidays', 'A day cannot be both a paid weekly holiday and an unpaid holiday.')
  }
  const maxWeek = fields.contractual_work_schedule_type === 'weekly' ? 1 : fields.contractual_work_schedule_type === 'biweekly' ? 2 : 5
  const seen = new Set<string>()
  for (const entry of fields.contractual_work_schedules) {
    const key = `${entry.week}:${entry.day_of_week}`
    if (entry.week > maxWeek) add(errors, 'contractual_work_schedules', `Week ${entry.week} is outside a ${fields.contractual_work_schedule_type} cycle.`)
    if (seen.has(key)) add(errors, 'contractual_work_schedules', `Week ${entry.week}, day ${entry.day_of_week} is listed twice.`)
    if (entry.hours > 0 && (fields.paid_weekly_holidays.includes(entry.day_of_week) || fields.unpaid_holidays.includes(entry.day_of_week))) {
      add(errors, 'contractual_work_schedules', `Day ${entry.day_of_week} is a holiday and cannot have contractual hours.`)
    }
    seen.add(key)
  }
  if (fields.weekly_rest_hours_input_method === 'manual' && fields.weekly_rest_hours === null) {
    add(errors, 'weekly_rest_hours', 'Enter the weekly rest hours when they are entered manually.')
  }
  if (scheduleHours(fields).weeklyContractualHours >= 15 && fields.paid_weekly_holidays.length === 0) {
    add(errors, 'paid_weekly_holidays', 'Workers with 15 or more contractual hours a week need a paid weekly holiday.')
  }
  const noOvertime = fields.fixed_overtime_work_schedule_type === 'none'
  if (noOvertime !== (fields.fixed_overtime_input_type === 'none')) {
    add(errors, 'fixed_overtime_input_type', 'Set both fixed overtime fields to none, or neither.')
  }
  if (noOvertime && fields.fixed_overtime_items.length > 0) add(errors, 'fixed_overtime_items', 'Remove fixed overtime items when there is no fixed overtime.')
  for (const item of fields.fixed_overtime_items) {
    if (fields.fixed_overtime_work_schedule_type === 'daily' && item.day_of_week === null) {
      add(errors, 'fixed_overtime_items', 'Daily fixed overtime needs a day of the week.')
    }
    if (fields.fixed_overtime_work_schedule_type !== 'daily' && item.day_of_week !== null) {
      add(errors, 'fixed_overtime_items', 'Weekly and monthly fixed overtime are totals without a day of the week.')
    }
  }
  if (Object.keys(errors).length > 0) throw new DomainError('VALIDATION_FAILED', 'Request validation failed.', { errors })
  return fields
}

/**
 * Deletes a work schedule policy that no employee uses.
 *
 * @throws {DomainError} `NOT_FOUND`, or `INVALID_TRANSITION` while it is in use.
 */
export function removeWorkSchedulePolicy(db: DatabaseSync, companyId: string, id: number, usage: SettingsUsageCounter): void {
  if (repo.findWorkSchedulePolicy(db, companyId, id) === undefined) throw notFound('Work schedule policy')
  if (usage.workSchedulePolicyUsages(companyId, id) > 0) {
    throw new DomainError('INVALID_TRANSITION', 'The work schedule policy is in use. Deactivate it instead.')
  }
  repo.deleteWorkSchedulePolicy(db, companyId, id)
}

/** Reads the editable fields of a stored payment item. */
export function paymentItemFieldsOf(row: PaymentItemRow): PaymentItemFields {
  return {
    name: row.name,
    source: row.source,
    catalog_code: row.catalog_code,
    default_amount: row.default_amount,
    is_taxable: row.is_taxable === 1,
    non_taxable_limit_enabled: row.non_taxable_limit_enabled === 1,
    non_taxable_limit_amount: row.non_taxable_limit_amount,
    include_in_monthly_salary: row.include_in_monthly_salary === 1,
    include_in_ordinary_wage: row.include_in_ordinary_wage === 1,
    include_in_average_wage: row.include_in_average_wage === 1,
    include_in_minimum_wage: row.include_in_minimum_wage === 1,
    show_formula_on_payslip: row.show_formula_on_payslip === 1,
    formula_text: row.formula_text,
  }
}

function catalogFields(catalog: PaymentCatalogItem | undefined): PaymentItemFields {
  return {
    name: catalog?.name ?? '',
    source: catalog === undefined ? 'custom' : 'catalog',
    catalog_code: catalog?.code ?? null,
    default_amount: null,
    is_taxable: catalog?.isTaxable ?? true,
    non_taxable_limit_enabled: false,
    non_taxable_limit_amount: null,
    include_in_monthly_salary: catalog?.includeInMonthlySalary ?? true,
    include_in_ordinary_wage: catalog?.includeInOrdinaryWage ?? false,
    include_in_average_wage: catalog?.includeInAverageWage ?? true,
    include_in_minimum_wage: catalog?.includeInMinimumWage ?? false,
    show_formula_on_payslip: false,
    formula_text: null,
  }
}

function validatePaymentItem(
  db: DatabaseSync,
  companyId: string,
  fields: PaymentItemFields,
  existing: PaymentItemRow | undefined,
  rates: PayrollRateTable,
): PaymentCatalogItem['nonTaxableCategory'] {
  const errors: FieldErrors = {}
  let category: PaymentCatalogItem['nonTaxableCategory'] = null
  if (fields.source === 'catalog') {
    const catalog = fields.catalog_code === null ? undefined : findCatalogItem(fields.catalog_code)
    if (fields.catalog_code === null) add(errors, 'catalog_code', 'Catalog items need a catalog code.')
    else if (catalog === undefined) add(errors, 'catalog_code', `Unknown catalog code "${fields.catalog_code}".`)
    else {
      if (catalog.standardNameRequired && fields.name !== catalog.name) {
        add(errors, 'name', `Non-taxable items and 연차수당 must keep the standard name "${catalog.name}".`)
      }
      if (fields.is_taxable !== catalog.isTaxable) add(errors, 'is_taxable', `"${catalog.name}" is ${catalog.isTaxable ? 'taxable' : 'non-taxable'}.`)
      category = catalog.nonTaxableCategory
    }
  } else {
    if (fields.catalog_code !== null) add(errors, 'catalog_code', 'Only catalog items have a catalog code.')
    if (!fields.is_taxable) add(errors, 'is_taxable', 'Non-taxable items must be loaded from the catalog with their standard name.')
    const standard = PAYMENT_CATALOG.find((entry) => entry.standardNameRequired && entry.name === fields.name)
    if (standard !== undefined) add(errors, 'name', `Load "${standard.name}" from the catalog instead of typing it.`)
  }
  if (fields.non_taxable_limit_enabled) {
    const statutory = category === null ? null : rates.nonTaxable[category].monthlyLimit
    if (fields.is_taxable) add(errors, 'non_taxable_limit_enabled', 'Only non-taxable items have a non-taxable limit.')
    else if (fields.non_taxable_limit_amount === null || fields.non_taxable_limit_amount <= 0) {
      add(errors, 'non_taxable_limit_amount', 'Enter a positive limit amount.')
    } else if (statutory !== null && fields.non_taxable_limit_amount > statutory) {
      add(errors, 'non_taxable_limit_amount', `The limit cannot exceed the statutory monthly limit of ${formatWon(statutory)} won.`)
    }
  }
  if (fields.show_formula_on_payslip && (fields.formula_text ?? '').trim() === '') {
    add(errors, 'formula_text', 'Enter the calculation method shown on payslips.')
  }
  if (existing?.is_system === 1) {
    if (fields.name !== existing.name) add(errors, 'name', 'System payment items cannot be renamed.')
    if (fields.source !== existing.source || fields.catalog_code !== existing.catalog_code) add(errors, 'source', 'System payment items keep their source.')
  }
  const duplicate = repo.findPaymentItemByName(db, companyId, fields.name)
  if (duplicate !== undefined && duplicate.id !== existing?.id) add(errors, 'name', 'A payment item with this name already exists.')
  if (Object.keys(errors).length > 0) throw new DomainError('VALIDATION_FAILED', 'Request validation failed.', { errors })
  return category
}

function normalize(fields: PaymentItemFields): PaymentItemFields {
  return {
    ...fields,
    non_taxable_limit_amount: fields.non_taxable_limit_enabled ? fields.non_taxable_limit_amount : null,
    formula_text: fields.formula_text === null || fields.formula_text.trim() === '' ? null : fields.formula_text.trim(),
  }
}

function validateDeductionItem(
  db: DatabaseSync,
  companyId: string,
  fields: Pick<DeductionItemRow, 'name' | 'amount_mode' | 'amount'>,
  existing: DeductionItemRow | undefined,
): Pick<DeductionItemRow, 'name' | 'amount_mode' | 'amount'> {
  const errors: FieldErrors = {}
  if (fields.amount_mode === 'fixed' && fields.amount === null) add(errors, 'amount', 'Fixed deduction items need an amount.')
  const duplicate = repo.findDeductionItemByName(db, companyId, fields.name)
  if (duplicate !== undefined && duplicate.id !== existing?.id) add(errors, 'name', 'A deduction item with this name already exists.')
  if (Object.keys(errors).length > 0) throw new DomainError('VALIDATION_FAILED', 'Request validation failed.', { errors })
  return { ...fields, amount: fields.amount_mode === 'fixed' ? fields.amount : null }
}

function add(errors: FieldErrors, field: string, message: string): void {
  ;(errors[field] ??= []).push(message)
}

function defined<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> }
}
