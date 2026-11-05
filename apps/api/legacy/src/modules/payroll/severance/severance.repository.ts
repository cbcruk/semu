import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { SeveranceResult } from '../engine/engine.types'
import type { InterimReason, MonthlyWageRow, MonthlyWageWrite, SeveranceInputData, SeveranceKind, SeveranceRow, SeveranceStatus } from './severance.types'

/** Columns written when a settlement is created. */
export interface SeveranceInsert {
  employeeId: number
  employeeName: string
  kind: SeveranceKind
  interimReason: InterimReason | null
  joinDate: PlainDate
  serviceStartDate: PlainDate
  baseDate: PlainDate
  retirementBenefitType: SeveranceRow['retirement_benefit_type']
  createdBy: string
}

/** Filters of the settlement list. */
export interface SeveranceFilter {
  kind?: SeveranceKind
  status?: SeveranceStatus
  search?: string
}

/** Inserts a settlement and returns its ID. */
export function insertSettlement(db: DatabaseSync, companyId: string, values: SeveranceInsert, now: string): number {
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO severance_settlements (company_id, employee_id, employee_name, kind, interim_reason, join_date, service_start_date, base_date,
       retirement_benefit_type, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      companyId,
      values.employeeId,
      values.employeeName,
      values.kind,
      values.interimReason,
      values.joinDate,
      values.serviceStartDate,
      values.baseDate,
      values.retirementBenefitType,
      values.createdBy,
      now,
      now,
    ],
  )
  if (row === undefined) throw new Error('Settlement insert returned no row.')
  return row.id
}

/** Finds a settlement of a company. */
export function findSettlement(db: DatabaseSync, companyId: string, id: number): SeveranceRow | undefined {
  return queryOne<SeveranceRow>(db, 'SELECT * FROM severance_settlements WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Lists a page of settlements matching the filters, newest first. */
export function listSettlements(db: DatabaseSync, companyId: string, filter: SeveranceFilter, limit: number, offset: number): { rows: SeveranceRow[]; count: number } {
  const { where, params } = whereOf(companyId, filter)
  const rows = queryAll<SeveranceRow>(db, `SELECT * FROM severance_settlements WHERE ${where} ORDER BY base_date DESC, id DESC LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset,
  ])
  const total = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM severance_settlements WHERE ${where}`, params)
  return { rows, count: total?.n ?? 0 }
}

/** Counts settlements per status, ignoring any status filter. */
export function countSettlementsByStatus(db: DatabaseSync, companyId: string, filter: SeveranceFilter): Record<SeveranceStatus, number> {
  const { where, params } = whereOf(companyId, { ...filter, status: undefined })
  const counts: Record<SeveranceStatus, number> = { in_progress: 0, completed: 0, excluded: 0 }
  for (const row of queryAll<{ status: SeveranceStatus; n: number }>(db, `SELECT status, COUNT(*) AS n FROM severance_settlements WHERE ${where} GROUP BY status`, params)) {
    counts[row.status] = row.n
  }
  return counts
}

/** Lists every settlement of an employee, oldest first. */
export function listSettlementsOfEmployee(db: DatabaseSync, companyId: string, employeeId: number): SeveranceRow[] {
  return queryAll<SeveranceRow>(db, 'SELECT * FROM severance_settlements WHERE company_id = ? AND employee_id = ? ORDER BY base_date, id', [companyId, employeeId])
}

/** Lists completed settlements whose payment date falls within a period. */
export function listCompletedSettlementsPaidBetween(db: DatabaseSync, companyId: string, from: PlainDate, to: PlainDate): SeveranceRow[] {
  return queryAll<SeveranceRow>(
    db,
    "SELECT * FROM severance_settlements WHERE company_id = ? AND status = 'completed' AND payment_date BETWEEN ? AND ? ORDER BY id",
    [companyId, from, to],
  )
}

/** Stores a settlement's input and calculation. */
export function saveSettlementCalculation(
  db: DatabaseSync,
  companyId: string,
  id: number,
  input: SeveranceInputData,
  result: SeveranceResult,
  now: string,
): void {
  execute(
    db,
    `UPDATE severance_settlements SET input = ?, result = ?, payment_date = ?, service_days = ?, average_daily_wage = ?, severance_pay = ?,
       retirement_income_tax = ?, local_income_tax = ?, net_pay = ?, updated_at = ?
     WHERE company_id = ? AND id = ?`,
    [
      JSON.stringify(input),
      JSON.stringify(result),
      input.payment_date ?? null,
      result.serviceDays,
      result.averageDailyWage,
      result.severancePay,
      result.retirementIncomeTax,
      result.localIncomeTax,
      result.netPay,
      now,
      companyId,
      id,
    ],
  )
}

/**
 * Moves a settlement between statuses when it is still in the expected one.
 *
 * @returns Whether the row changed.
 */
export function transitionSettlement(
  db: DatabaseSync,
  companyId: string,
  id: number,
  from: SeveranceStatus,
  to: SeveranceStatus,
  extra: { exclude_reason?: string | null; completed_at?: string | null },
  now: string,
): boolean {
  const columns = Object.keys(extra) as (keyof typeof extra)[]
  return (
    execute(
      db,
      `UPDATE severance_settlements SET ${['status = ?', ...columns.map((column) => `${column} = ?`), 'version = version + 1', 'updated_at = ?'].join(', ')}
       WHERE company_id = ? AND id = ? AND status = ?`,
      [to, ...columns.map((column) => extra[column] ?? null), now, companyId, id, from],
    ) > 0
  )
}

/** Deletes a settlement; its monthly wages cascade. */
export function deleteSettlement(db: DatabaseSync, companyId: string, id: number): boolean {
  return execute(db, 'DELETE FROM severance_settlements WHERE company_id = ? AND id = ?', [companyId, id]) > 0
}

/** Replaces a settlement's monthly wages. */
export function replaceMonthlyWages(db: DatabaseSync, settlementId: number, wages: readonly MonthlyWageWrite[]): void {
  execute(db, 'DELETE FROM severance_monthly_wages WHERE settlement_id = ?', [settlementId])
  for (const wage of wages) {
    execute(
      db,
      `INSERT INTO severance_monthly_wages (settlement_id, month, period_start, period_end, days, base_pay, allowances, total, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [settlementId, wage.month, wage.period_start, wage.period_end, wage.days, wage.base_pay, wage.allowances, wage.total, wage.source],
    )
  }
}

/** Lists a settlement's monthly wages in date order. */
export function listMonthlyWages(db: DatabaseSync, settlementId: number): MonthlyWageRow[] {
  return queryAll<MonthlyWageRow>(db, 'SELECT * FROM severance_monthly_wages WHERE settlement_id = ? ORDER BY period_start', [settlementId])
}

/** Updates one monthly wage entered by hand. */
export function updateMonthlyWage(db: DatabaseSync, settlementId: number, id: number, basePay: number, allowances: number): boolean {
  return (
    execute(db, "UPDATE severance_monthly_wages SET base_pay = ?, allowances = ?, total = ?, source = 'manual' WHERE settlement_id = ? AND id = ?", [
      basePay,
      allowances,
      basePay + allowances,
      settlementId,
      id,
    ]) > 0
  )
}

/** Lists the employees that already have a settlement of a kind in one of some statuses. */
export function employeesWithSettlement(db: DatabaseSync, companyId: string, kind: SeveranceKind, statuses: readonly SeveranceStatus[]): Set<number> {
  return new Set(
    queryAll<{ employee_id: number }>(
      db,
      `SELECT DISTINCT employee_id FROM severance_settlements WHERE company_id = ? AND kind = ? AND status IN (${placeholders(statuses.length)})`,
      [companyId, kind, ...statuses],
    ).map((row) => row.employee_id),
  )
}

function whereOf(companyId: string, filter: SeveranceFilter): { where: string; params: SqlValue[] } {
  const clauses = ['company_id = ?']
  const params: SqlValue[] = [companyId]
  if (filter.kind !== undefined) {
    clauses.push('kind = ?')
    params.push(filter.kind)
  }
  if (filter.status !== undefined) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  if (filter.search !== undefined && filter.search !== '') {
    clauses.push("employee_name LIKE ? ESCAPE '\\'")
    params.push(`%${filter.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
  }
  return { where: clauses.join(' AND '), params }
}
