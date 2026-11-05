/**
 * Employee storage and the read contract other domains use.
 *
 * Payroll, e-sign and certificates read employees only through the functions
 * exported here. The "as of" accessors return the sub-resource row in force
 * on a given date, so a payroll run for October reads October's contract and
 * deduction settings even after November's are saved.
 *
 * @example Payroll reading an employee for a pay period
 * ```ts
 * import {
 *   countDependantsAsOf,
 *   findDeductionInfoAsOf,
 *   findPayrollContractAsOf,
 *   listEmployeesEmployedBetween,
 * } from '../hr/employees/employees.repository'
 *
 * for (const employee of listEmployeesEmployedBetween(db, companyId, '2026-10-01', '2026-10-31')) {
 *   const contract = findPayrollContractAsOf(db, cipher, companyId, employee.id, '2026-10-31')
 *   const deduction = findDeductionInfoAsOf(db, companyId, employee.id, '2026-10-31')
 *   const dependants = countDependantsAsOf(db, companyId, employee.id, '2026-10-31')
 * }
 * ```
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { Cipher } from '../../../lib/crypto/crypto.types'
import { addDays } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { EmployeeKind } from '../shared/hr.types'
import { EMPLOYEE_VIEW_SQL } from './employee-view.sql'
import type { EmployeeListFilter, EmployeeRecord, EmployeeRow, EmployeeStatus, EmployeeView, EmployeeWrite } from './employees.types'
import { toEmployeeRecord } from './employees.utils'

export { countDependantsAsOf } from '../family/family.repository'
export { findDeductionInfoAsOf } from '../deduction/deduction.repository'
export { findPayrollContractAsOf, findWorkContractAsOf, listWorkContracts } from '../contracts/contracts.repository'
export { listLeavesOverlapping } from '../leaves/leaves.repository'
export { findRetirementInfo, setSeveranceSettlementStatus } from '../retirement/retirement.repository'
export { findSocialInsuranceAsOf } from '../social-insurance/social-insurance.repository'
export { fromEmploymentType, toEmploymentType } from '../shared/hr.utils'

/** Days before a fixed-term contract's end date at which it counts as expiring soon. */
export const CONTRACT_EXPIRY_WARNING_DAYS = 30

const ORDER_COLUMNS: Record<string, string> = {
  name: 'name',
  status: "CASE status WHEN 'PRE_JOINED' THEN 1 WHEN 'JOINED' THEN 3 WHEN 'LEAVE' THEN 4 ELSE 5 END",
  birth_date: 'birth_date',
  join_date: 'join_date',
  leave_date: 'leave_date',
  department: 'department_name',
  position: 'position_name',
  employee_number: 'employee_number',
  created: 'created_at',
}

/** Finds an employee row of any kind within a company. */
export function findEmployeeRow(db: DatabaseSync, companyId: string, employeeId: number): EmployeeRow | undefined {
  return queryOne<EmployeeRow>(db, 'SELECT * FROM employees WHERE company_id = ? AND id = ?', [companyId, employeeId])
}

/** Loads one employee with its computed status and current contract. */
export function findEmployeeView(db: DatabaseSync, companyId: string, employeeId: number, today: PlainDate): EmployeeView | undefined {
  return queryOne<EmployeeView>(db, `${EMPLOYEE_VIEW_SQL} AND id = ?3`, [companyId, today, employeeId])
}

/** Lists a page of employees of one kind matching the list filters. */
export function listEmployeeViews(
  db: DatabaseSync,
  companyId: string,
  kind: EmployeeKind,
  filter: EmployeeListFilter,
  today: PlainDate,
  page: { limit: number; offset: number } | null,
): { rows: EmployeeView[]; count: number } {
  const { where, params } = buildFilter(kind, filter, today)
  const order = buildOrder(filter.ordering)
  const limit = page === null ? '' : ` LIMIT ${page.limit} OFFSET ${page.offset}`
  const rows = queryAll<EmployeeView>(db, `${EMPLOYEE_VIEW_SQL}${where} ORDER BY ${order}${limit}`, [companyId, today, ...params])
  const total = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM (${EMPLOYEE_VIEW_SQL}${where})`, [companyId, today, ...params])
  return { rows, count: total?.n ?? 0 }
}

/** Counts employees of one kind per computed status, ignoring any status filter. */
export function countEmployeesByStatus(
  db: DatabaseSync,
  companyId: string,
  kind: EmployeeKind,
  filter: EmployeeListFilter,
  today: PlainDate,
): Record<Exclude<EmployeeStatus, 'WORKING'>, number> {
  const { where, params } = buildFilter(kind, { ...filter, statuses: [] }, today)
  const rows = queryAll<{ status: Exclude<EmployeeStatus, 'WORKING'>; n: number }>(
    db,
    `SELECT status, COUNT(*) AS n FROM (${EMPLOYEE_VIEW_SQL}${where}) GROUP BY status`,
    [companyId, today, ...params],
  )
  const counts = { PRE_JOINED: 0, JOINED: 0, LEAVE: 0, RESIGNED: 0 }
  for (const row of rows) counts[row.status] = row.n
  return counts
}

/** Finds employees of one kind whose stored registration hash matches. */
export function findEmployeesByRegistrationHash(
  db: DatabaseSync,
  companyId: string,
  kind: EmployeeKind,
  hash: string,
  today: PlainDate,
): EmployeeView[] {
  return queryAll<EmployeeView>(db, `${EMPLOYEE_VIEW_SQL} AND kind = ?3 AND registration_number_hash = ?4`, [companyId, today, kind, hash])
}

/** Inserts an employee and returns its ID. */
export function insertEmployee(
  db: DatabaseSync,
  companyId: string,
  kind: EmployeeKind,
  values: EmployeeWrite,
  source: EmployeeRow['source'],
  createdBy: string | null,
  now: string,
): number {
  const columns = Object.keys(values) as (keyof EmployeeWrite)[]
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO employees (company_id, kind, source, created_by, created_at, updated_at, ${columns.join(', ')})
     VALUES (?, ?, ?, ?, ?, ?, ${placeholders(columns.length)}) RETURNING id`,
    [companyId, kind, source, createdBy, now, now, ...columns.map((column) => values[column])],
  )
  if (row === undefined) throw new Error('Employee insert returned no row.')
  return row.id
}

/** Updates an employee's columns, returning whether the row exists. */
export function updateEmployee(db: DatabaseSync, companyId: string, employeeId: number, values: Partial<EmployeeWrite>, now: string): boolean {
  const columns = Object.keys(values) as (keyof EmployeeWrite)[]
  const assignments = columns.map((column) => `${column} = ?`)
  return (
    execute(db, `UPDATE employees SET ${[...assignments, 'updated_at = ?'].join(', ')} WHERE company_id = ? AND id = ?`, [
      ...columns.map((column) => values[column] ?? null),
      now,
      companyId,
      employeeId,
    ]) > 0
  )
}

/**
 * Bumps an employee's version when it still equals `expectedVersion`.
 *
 * @returns Whether the version matched; status-changing writes run only when it did.
 */
export function bumpEmployeeVersion(db: DatabaseSync, companyId: string, employeeId: number, expectedVersion: number, now: string): boolean {
  return (
    execute(db, 'UPDATE employees SET version = version + 1, updated_at = ? WHERE company_id = ? AND id = ? AND version = ?', [
      now,
      companyId,
      employeeId,
      expectedVersion,
    ]) > 0
  )
}

/** Deletes an employee; sub-resources cascade. */
export function deleteEmployeeRow(db: DatabaseSync, companyId: string, employeeId: number): boolean {
  return execute(db, 'DELETE FROM employees WHERE company_id = ? AND id = ?', [companyId, employeeId]) > 0
}

/** Marks a department and position as used so they can no longer be deleted. */
export function markOrganizationUsed(db: DatabaseSync, companyId: string, departmentId: number | null, positionId: number | null): void {
  if (departmentId !== null) execute(db, 'UPDATE departments SET is_used = 1 WHERE company_id = ? AND id = ?', [companyId, departmentId])
  if (positionId !== null) execute(db, 'UPDATE positions SET is_used = 1 WHERE company_id = ? AND id = ?', [companyId, positionId])
}

/** Finds an employee of any kind for another domain, without decrypting personal data. */
export function findEmployee(db: DatabaseSync, companyId: string, employeeId: number, today: PlainDate): EmployeeRecord | undefined {
  const view = findEmployeeView(db, companyId, employeeId, today)
  return view === undefined ? undefined : toEmployeeRecord(view)
}

/** Lists a company's employees, optionally restricted to some kinds. */
export function listEmployees(db: DatabaseSync, companyId: string, today: PlainDate, kinds?: readonly EmployeeKind[]): EmployeeRecord[] {
  const kindFilter = kinds === undefined || kinds.length === 0 ? '' : ` AND kind IN (${kinds.map((_, index) => `?${index + 3}`).join(', ')})`
  return queryAll<EmployeeView>(db, `${EMPLOYEE_VIEW_SQL}${kindFilter} ORDER BY name, id`, [companyId, today, ...(kinds ?? [])]).map(
    toEmployeeRecord,
  )
}

/**
 * Lists employees whose employment overlaps a period, such as a pay month.
 *
 * An employee overlaps when they joined on or before `to` and had not left before `from`.
 */
export function listEmployeesEmployedBetween(
  db: DatabaseSync,
  companyId: string,
  from: PlainDate,
  to: PlainDate,
  kinds: readonly EmployeeKind[] = ['wage-salary'],
): EmployeeRecord[] {
  const kindList = kinds.map((_, index) => `?${index + 5}`).join(', ')
  return queryAll<EmployeeView>(
    db,
    `${EMPLOYEE_VIEW_SQL} AND (join_date IS NULL OR join_date <= ?3) AND (leave_date IS NULL OR leave_date >= ?4) AND kind IN (${kindList})
     ORDER BY name, id`,
    [companyId, to, to, from, ...kinds],
  ).map(toEmployeeRecord)
}

/** Computes an employee's status on a date, or `undefined` when the employee does not exist. */
export function getEmployeeStatusAsOf(db: DatabaseSync, companyId: string, employeeId: number, date: PlainDate): Exclude<EmployeeStatus, 'WORKING'> | undefined {
  return findEmployeeView(db, companyId, employeeId, date)?.status
}

/**
 * Decrypts an employee's registration or passport number for filings that must carry it.
 *
 * Callers must not log or return the value; responses use the masked form.
 *
 * @returns The plaintext number, or `null` when none is stored.
 */
export function revealRegistrationNumber(db: DatabaseSync, cipher: Cipher, companyId: string, employeeId: number): string | null {
  const row = queryOne<{ registration_number_enc: string | null }>(
    db,
    'SELECT registration_number_enc FROM employees WHERE company_id = ? AND id = ?',
    [companyId, employeeId],
  )
  return row?.registration_number_enc == null ? null : cipher.decrypt(row.registration_number_enc)
}

function buildFilter(kind: EmployeeKind, filter: EmployeeListFilter, today: PlainDate): { where: string; params: SqlValue[] } {
  const clauses: string[] = []
  const params: SqlValue[] = []
  const param = (value: SqlValue): string => {
    params.push(value)
    return `?${params.length + 2}`
  }
  clauses.push(`kind = ${param(kind)}`)
  const statuses = new Set<string>()
  for (const status of filter.statuses) {
    if (status === 'WORKING') statuses.add('JOINED')
    else if (status === 'JOINED') {
      statuses.add('JOINED')
      statuses.add('LEAVE')
    } else statuses.add(status)
  }
  if (statuses.size > 0) clauses.push(`status IN (${[...statuses].map((status) => param(status)).join(', ')})`)
  if (filter.search !== null && filter.search !== '') {
    const like = param(`%${filter.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
    clauses.push(`(name LIKE ${like} ESCAPE '\\' OR department_name LIKE ${like} ESCAPE '\\' OR position_name LIKE ${like} ESCAPE '\\')`)
  }
  if (filter.dateType !== null) {
    if (filter.startDate !== null) clauses.push(`${filter.dateType} >= ${param(filter.startDate)}`)
    if (filter.endDate !== null) clauses.push(`${filter.dateType} <= ${param(filter.endDate)}`)
  }
  if (filter.contractFilter === 'expiring_soon') {
    clauses.push(
      `contract_type = 'contract' AND status <> 'RESIGNED' AND contract_end_date >= ${param(today)} AND contract_end_date <= ${param(addDays(today, CONTRACT_EXPIRY_WARNING_DAYS))}`,
    )
  } else if (filter.contractFilter === 'expired') {
    clauses.push(`contract_type = 'contract' AND status <> 'RESIGNED' AND contract_end_date < ${param(today)} AND contract_followed = 0`)
  }
  return { where: clauses.map((clause) => ` AND ${clause}`).join(''), params }
}

function buildOrder(ordering: string | null): string {
  const terms = (ordering ?? 'name')
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term !== '')
    .flatMap((term) => {
      const descending = term.startsWith('-')
      const column = ORDER_COLUMNS[descending ? term.slice(1) : term]
      return column === undefined ? [] : [`${column} ${descending ? 'DESC' : 'ASC'}`]
    })
  return [...terms, 'id ASC'].join(', ')
}
