import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne } from '../../../db/query'
import type { Cipher } from '../../../lib/crypto/crypto.types'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { PaymentItemValue, PayrollContractRecord, PayrollContractRow, PayrollContractWrite, WorkContractRow, WorkContractWrite } from './contracts.types'

/** Lists an employee's work contracts, oldest first. */
export function listWorkContracts(db: DatabaseSync, companyId: string, employeeId: number): WorkContractRow[] {
  return queryAll<WorkContractRow>(
    db,
    'SELECT * FROM employee_work_contracts WHERE company_id = ? AND employee_id = ? ORDER BY start_date, id',
    [companyId, employeeId],
  )
}

/** Lists the fixed-term work contracts of several employees, for list warnings. */
export function listFixedTermContracts(db: DatabaseSync, companyId: string, employeeIds: readonly number[]): WorkContractRow[] {
  if (employeeIds.length === 0) return []
  return queryAll<WorkContractRow>(
    db,
    `SELECT * FROM employee_work_contracts WHERE company_id = ? AND contract_type = 'contract' AND employee_id IN (${placeholders(employeeIds.length)})
     ORDER BY employee_id, start_date`,
    [companyId, ...employeeIds],
  )
}

/** Finds one work contract of an employee. */
export function findWorkContract(db: DatabaseSync, companyId: string, employeeId: number, contractId: number): WorkContractRow | undefined {
  return queryOne<WorkContractRow>(db, 'SELECT * FROM employee_work_contracts WHERE company_id = ? AND employee_id = ? AND id = ?', [
    companyId,
    employeeId,
    contractId,
  ])
}

/**
 * Finds the work contract in force on a date.
 *
 * When contracts overlap the one that started most recently wins.
 *
 * @returns The contract, or `undefined` when none covers the date.
 */
export function findWorkContractAsOf(db: DatabaseSync, companyId: string, employeeId: number, date: PlainDate): WorkContractRow | undefined {
  return queryOne<WorkContractRow>(
    db,
    `SELECT * FROM employee_work_contracts
     WHERE company_id = ? AND employee_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
     ORDER BY start_date DESC, id DESC LIMIT 1`,
    [companyId, employeeId, date, date],
  )
}

/** Inserts a work contract and returns its ID. */
export function insertWorkContract(db: DatabaseSync, companyId: string, employeeId: number, values: WorkContractWrite, now: string): number {
  return insertRow(db, 'employee_work_contracts', companyId, employeeId, values, now)
}

/** Replaces a work contract's values. */
export function updateWorkContract(db: DatabaseSync, companyId: string, contractId: number, values: WorkContractWrite, now: string): void {
  updateRow(db, 'employee_work_contracts', companyId, contractId, values, now)
}

/** Deletes a work contract. */
export function deleteWorkContract(db: DatabaseSync, companyId: string, employeeId: number, contractId: number): boolean {
  return execute(db, 'DELETE FROM employee_work_contracts WHERE company_id = ? AND employee_id = ? AND id = ?', [companyId, employeeId, contractId]) > 0
}

/** Lists an employee's payroll contracts, newest first. */
export function listPayrollContracts(db: DatabaseSync, companyId: string, employeeId: number): PayrollContractRow[] {
  return queryAll<PayrollContractRow>(
    db,
    'SELECT * FROM employee_payroll_contracts WHERE company_id = ? AND employee_id = ? ORDER BY start_date DESC, id DESC',
    [companyId, employeeId],
  )
}

/** Finds one payroll contract of an employee. */
export function findPayrollContract(db: DatabaseSync, companyId: string, employeeId: number, contractId: number): PayrollContractRow | undefined {
  return queryOne<PayrollContractRow>(db, 'SELECT * FROM employee_payroll_contracts WHERE company_id = ? AND employee_id = ? AND id = ?', [
    companyId,
    employeeId,
    contractId,
  ])
}

/**
 * Finds the payroll contract in force on a date, with the account number decrypted for payment files.
 *
 * @returns The contract, or `undefined` when none covers the date.
 */
export function findPayrollContractAsOf(
  db: DatabaseSync,
  cipher: Cipher,
  companyId: string,
  employeeId: number,
  date: PlainDate,
): PayrollContractRecord | undefined {
  const row = queryOne<PayrollContractRow>(
    db,
    `SELECT * FROM employee_payroll_contracts
     WHERE company_id = ? AND employee_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
     ORDER BY start_date DESC, id DESC LIMIT 1`,
    [companyId, employeeId, date, date],
  )
  return row === undefined ? undefined : toPayrollContractRecord(row, cipher)
}

/** Converts a stored payroll contract into the record payroll reads. */
export function toPayrollContractRecord(row: PayrollContractRow, cipher: Cipher): PayrollContractRecord {
  const { account_number_enc: encrypted, payment_items: items, ...rest } = row
  return {
    ...rest,
    account_number: encrypted === null ? null : cipher.decrypt(encrypted),
    payment_items: JSON.parse(items) as PaymentItemValue[],
  }
}

/** Inserts a payroll contract and returns its ID. */
export function insertPayrollContract(db: DatabaseSync, companyId: string, employeeId: number, values: PayrollContractWrite, now: string): number {
  return insertRow(db, 'employee_payroll_contracts', companyId, employeeId, values, now)
}

/** Replaces a payroll contract's values. */
export function updatePayrollContract(db: DatabaseSync, companyId: string, contractId: number, values: PayrollContractWrite, now: string): void {
  updateRow(db, 'employee_payroll_contracts', companyId, contractId, values, now)
}

/** Deletes a payroll contract. */
export function deletePayrollContract(db: DatabaseSync, companyId: string, employeeId: number, contractId: number): boolean {
  return execute(db, 'DELETE FROM employee_payroll_contracts WHERE company_id = ? AND employee_id = ? AND id = ?', [companyId, employeeId, contractId]) > 0
}

function insertRow(db: DatabaseSync, table: string, companyId: string, employeeId: number, values: object, now: string): number {
  const entries = Object.entries(values)
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO ${table} (company_id, employee_id, created_at, updated_at, ${entries.map(([column]) => column).join(', ')})
     VALUES (?, ?, ?, ?, ${placeholders(entries.length)}) RETURNING id`,
    [companyId, employeeId, now, now, ...entries.map(([, value]) => value as string | number | null)],
  )
  if (row === undefined) throw new Error(`${table} insert returned no row.`)
  return row.id
}

function updateRow(db: DatabaseSync, table: string, companyId: string, id: number, values: object, now: string): void {
  const entries = Object.entries(values)
  execute(db, `UPDATE ${table} SET ${entries.map(([column]) => `${column} = ?`).join(', ')}, updated_at = ? WHERE company_id = ? AND id = ?`, [
    ...entries.map(([, value]) => value as string | number | null),
    now,
    companyId,
    id,
  ])
}
