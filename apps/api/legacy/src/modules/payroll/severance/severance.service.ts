/**
 * Severance settlements (퇴직금 정산): retirement and interim settlements on top of the engine.
 *
 * Monthly wages of the average-wage base come from the employee's calculated
 * payroll rows, or the payroll contract when a month has none. Retirement
 * settlements mirror their status into HR with `setSeveranceSettlementStatus`.
 * Functions run inside the caller's transaction.
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import type { ServiceDeps } from '../../../app.types'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { addDays, addMonths, daysBetween, daysInMonth } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import {
  findEmployee,
  findPayrollContractAsOf,
  findRetirementInfo,
  getEmployeeStatusAsOf,
  listEmployees,
  setSeveranceSettlementStatus,
} from '../../hr/employees/employees.repository'
import type { EmployeeRecord } from '../../hr/employees/employees.types'
import { sum } from '../engine/engine.utils'
import type { PayrollRowResult } from '../engine/engine.types'
import type { PayrollRateTable } from '../engine/rate-table.types'
import { calculateSeverancePay } from '../engine/severance'
import { CALCULATED_STATUSES } from '../cards/card-status'
import { listEmployeeWageRowsOfMonth } from '../cards/cards.repository'
import { parseJsonColumn } from '../cards/cards.utils'
import { PayrollError } from '../payroll-error'
import { loadRateTables } from '../reference/rate-tables.repository'
import { findTerms } from '../settings/settings.repository'
import { ensurePayrollSettings } from '../settings/settings.service'
import * as repo from './severance.repository'
import type { createSettlementBody, settlementInputBody } from './severance.schema'
import type { InterimReason, MonthlyWageWrite, SeveranceInputData, SeveranceKind, SeveranceRow, SeveranceStatus } from './severance.types'

/** Who acts on a settlement. */
export interface SeveranceCaller {
  actor: 'client' | 'agency'
  userId: string
}

/** An employee offered by the candidate lists. */
export interface SeveranceCandidate {
  employee: EmployeeRecord
  serviceStartDate: PlainDate
  baseDate: PlainDate
  serviceDays: number
  retirementBenefitType: SeveranceRow['retirement_benefit_type']
}

/**
 * Rejects settlement writes from client users; the agency calculates severance (spec 5.11).
 *
 * @throws {DomainError} `PERMISSION_DENIED`.
 */
export function assertAgency(caller: SeveranceCaller): void {
  if (caller.actor !== 'agency') throw new DomainError('PERMISSION_DENIED', 'Only agency staff can change severance settlements.')
}

/**
 * Lists retirement candidates: employees with a leave date, the `grant` scheme,
 * a year of service since the last interim settlement and no open or completed retirement settlement.
 */
export function retirementCandidates(deps: ServiceDeps, companyId: string): SeveranceCandidate[] {
  const { db, clock } = deps
  const taken = repo.employeesWithSettlement(db, companyId, 'retirement', ['in_progress', 'completed'])
  return listEmployees(db, companyId, clock.today(), ['wage-salary']).flatMap((employee) => {
    if (taken.has(employee.id)) return []
    const info = findRetirementInfo(db, companyId, employee.id)
    const leaveDate = (info?.leave_date ?? employee.leaveDate) as PlainDate | null
    const scheme = info?.retirement_benefit_type ?? defaultScheme(db, companyId)
    if (leaveDate === null || employee.joinDate === null || scheme !== 'grant') return []
    const start = serviceStartOf(db, companyId, employee)
    const days = daysBetween(start, leaveDate) + 1
    return days >= 365 ? [{ employee, serviceStartDate: start, baseDate: leaveDate, serviceDays: days, retirementBenefitType: scheme }] : []
  })
}

/** Lists interim candidates: employees employed on the base date with the `grant` scheme and a year of service. */
export function interimCandidates(deps: ServiceDeps, companyId: string, baseDate: PlainDate): SeveranceCandidate[] {
  const { db, clock } = deps
  const open = repo.employeesWithSettlement(db, companyId, 'interim', ['in_progress'])
  return listEmployees(db, companyId, clock.today(), ['wage-salary']).flatMap((employee) => {
    if (open.has(employee.id) || employee.joinDate === null) return []
    const status = getEmployeeStatusAsOf(db, companyId, employee.id, baseDate)
    if (status !== 'JOINED' && status !== 'LEAVE') return []
    const scheme = findRetirementInfo(db, companyId, employee.id)?.retirement_benefit_type ?? defaultScheme(db, companyId)
    if (scheme !== 'grant') return []
    const start = serviceStartOf(db, companyId, employee)
    const days = daysBetween(start, baseDate) + 1
    return days >= 365 ? [{ employee, serviceStartDate: start, baseDate, serviceDays: days, retirementBenefitType: scheme }] : []
  })
}

/**
 * Creates settlements for several employees and calculates them once.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for employees that are not candidates.
 * @throws {PayrollError} `LEAVE_DATE_BEFORE_INTERIM` when a leave date precedes a completed interim settlement.
 */
export function createSettlements(deps: ServiceDeps, companyId: string, body: z.infer<typeof createSettlementBody>, caller: SeveranceCaller): SeveranceRow[] {
  assertAgency(caller)
  const { db, clock } = deps
  const now = clock.now()
  ensurePayrollSettings(db, companyId, now)
  const baseDate = body.base_date ?? clock.today()
  for (const employeeId of body.employee_ids) assertLeaveAfterInterim(db, companyId, body.kind, employeeId)
  const candidates = new Map(
    (body.kind === 'retirement' ? retirementCandidates(deps, companyId) : interimCandidates(deps, companyId, baseDate)).map((candidate) => [
      candidate.employee.id,
      candidate,
    ]),
  )
  const missing = body.employee_ids.filter((employeeId) => !candidates.has(employeeId))
  if (missing.length > 0) throw invalidField('employee_ids', `Employees ${missing.join(', ')} are not ${body.kind} settlement candidates.`)
  return body.employee_ids.map((employeeId) => {
    const candidate = candidates.get(employeeId)
    if (candidate === undefined) throw notFound('Employee')
    const id = repo.insertSettlement(
      db,
      companyId,
      {
        employeeId,
        employeeName: candidate.employee.name,
        kind: body.kind,
        interimReason: body.kind === 'interim' ? ((body.reason ?? null) as InterimReason | null) : null,
        joinDate: candidate.employee.joinDate ?? candidate.serviceStartDate,
        serviceStartDate: candidate.serviceStartDate,
        baseDate: candidate.baseDate,
        retirementBenefitType: candidate.retirementBenefitType,
        createdBy: caller.userId,
      },
      now,
    )
    const settlement = requireSettlement(db, companyId, id)
    repo.replaceMonthlyWages(db, id, monthlyWagesOf(deps, settlement))
    recalculate(db, settlement, {}, now)
    if (body.kind === 'retirement') setSeveranceSettlementStatus(db, companyId, employeeId, 'in_progress', now)
    return requireSettlement(db, companyId, id)
  })
}

/**
 * Saves entered amounts and recalculates (`temp-save`); `complete` also closes the settlement.
 *
 * @throws {DomainError} `INVALID_TRANSITION` unless the settlement is in progress.
 */
export function saveSettlement(
  deps: ServiceDeps,
  settlement: SeveranceRow,
  body: z.infer<typeof settlementInputBody>,
  caller: SeveranceCaller,
  complete: boolean,
  expectedVersion: number | null,
): SeveranceRow {
  assertAgency(caller)
  const { db, clock } = deps
  if (settlement.status !== 'in_progress') throw new DomainError('INVALID_TRANSITION', `A ${settlement.status} settlement cannot be edited.`)
  if (expectedVersion !== null && expectedVersion !== settlement.version) throw new DomainError('VERSION_CONFLICT', 'The settlement changed since you loaded it.')
  const now = clock.now()
  for (const wage of body.monthly_wages ?? []) {
    if (!repo.updateMonthlyWage(db, settlement.id, wage.id, wage.base_pay, wage.allowances)) throw invalidField('monthly_wages', `Monthly wage ${wage.id} not found.`)
  }
  const { monthly_wages: _wages, ...amounts } = body
  const input: SeveranceInputData = { ...parseJsonColumn<SeveranceInputData>(settlement.input, {}), ...amounts }
  if (complete && input.payment_date === undefined) input.payment_date = settlement.base_date
  recalculate(db, settlement, input, now)
  if (complete) {
    if (!repo.transitionSettlement(db, settlement.company_id, settlement.id, 'in_progress', 'completed', { completed_at: now }, now)) {
      throw new DomainError('VERSION_CONFLICT', 'The settlement changed since you loaded it.')
    }
    mirrorStatus(db, settlement, 'completed', now)
  }
  return requireSettlement(db, settlement.company_id, settlement.id)
}

/**
 * Moves a settlement between `in_progress`, `completed` and `excluded` (`reopen`, `exclude`, `include`).
 *
 * @throws {DomainError} `INVALID_TRANSITION` or `VERSION_CONFLICT`.
 */
export function moveSettlement(
  deps: ServiceDeps,
  settlement: SeveranceRow,
  action: 'reopen' | 'exclude' | 'include',
  caller: SeveranceCaller,
  expectedVersion: number,
  reason?: string,
): SeveranceRow {
  assertAgency(caller)
  const { db, clock } = deps
  const from: SeveranceStatus = action === 'reopen' ? 'completed' : action === 'exclude' ? 'in_progress' : 'excluded'
  const to: SeveranceStatus = action === 'exclude' ? 'excluded' : 'in_progress'
  if (settlement.status !== from) throw new DomainError('INVALID_TRANSITION', `Cannot ${action} a ${settlement.status} settlement.`)
  if (settlement.version !== expectedVersion) throw new DomainError('VERSION_CONFLICT', 'The settlement changed since you loaded it.')
  const now = clock.now()
  const extra = action === 'exclude' ? { exclude_reason: reason ?? null } : action === 'include' ? { exclude_reason: null } : { completed_at: null }
  if (!repo.transitionSettlement(db, settlement.company_id, settlement.id, from, to, extra, now)) {
    throw new DomainError('VERSION_CONFLICT', 'The settlement changed since you loaded it.')
  }
  mirrorStatus(db, settlement, to, now)
  return requireSettlement(db, settlement.company_id, settlement.id)
}

/**
 * Deletes a settlement that is still in progress, clearing HR's settlement status.
 *
 * @throws {DomainError} `INVALID_TRANSITION` for completed or excluded settlements.
 */
export function removeSettlement(deps: ServiceDeps, settlement: SeveranceRow, caller: SeveranceCaller): void {
  assertAgency(caller)
  if (settlement.status !== 'in_progress') throw new DomainError('INVALID_TRANSITION', 'Only a settlement in progress can be deleted.')
  repo.deleteSettlement(deps.db, settlement.company_id, settlement.id)
  mirrorStatus(deps.db, settlement, null, deps.clock.now())
}

/**
 * Finds a settlement of a company.
 *
 * @throws {DomainError} `NOT_FOUND`.
 */
export function requireSettlement(db: DatabaseSync, companyId: string, id: number): SeveranceRow {
  const row = repo.findSettlement(db, companyId, id)
  if (row === undefined) throw notFound('Severance settlement')
  return row
}

/**
 * Splits the three calendar months before the retirement date into monthly wage entries.
 *
 * A month's wage is the gross pay of the employee's calculated wage rows of
 * that attribution month (base pay vs. the rest), else the payroll contract's
 * monthly amount; partial months are prorated by calendar days.
 */
export function monthlyWagesOf(deps: ServiceDeps, settlement: SeveranceRow): MonthlyWageWrite[] {
  const { db, cipher } = deps
  const retirementDate = addDays(settlement.base_date, 1)
  const wages: MonthlyWageWrite[] = []
  let cursor = addMonths(retirementDate, -3)
  while (cursor <= settlement.base_date) {
    const month = cursor.slice(0, 7)
    const year = Number(month.slice(0, 4))
    const monthNumber = Number(month.slice(5, 7))
    const monthEnd = `${month}-${String(daysInMonth(year, monthNumber)).padStart(2, '0')}` as PlainDate
    const end = monthEnd < settlement.base_date ? monthEnd : settlement.base_date
    const days = daysBetween(cursor, end) + 1
    const full = monthAmounts(db, cipher, settlement, month, end)
    const ratio = (value: number): number => (days >= daysInMonth(year, monthNumber) ? value : Math.floor((value * days) / daysInMonth(year, monthNumber)))
    const basePay = ratio(full.basePay)
    const allowances = ratio(full.allowances)
    wages.push({ month, period_start: cursor, period_end: end, days, base_pay: basePay, allowances, total: basePay + allowances, source: full.source })
    cursor = addDays(end, 1)
  }
  return wages
}

function monthAmounts(
  db: DatabaseSync,
  cipher: ServiceDeps['cipher'],
  settlement: SeveranceRow,
  month: string,
  asOf: PlainDate,
): { basePay: number; allowances: number; source: 'payroll' | 'contract' } {
  const rows = listEmployeeWageRowsOfMonth(db, settlement.company_id, settlement.employee_id, month, CALCULATED_STATUSES)
  if (rows.length > 0) {
    const basePay = sum(rows.map((row) => parseJsonColumn<PayrollRowResult | null>(row.result, null)?.payments.find((line) => line.code === 'base_pay')?.amount ?? 0))
    const gross = sum(rows.map((row) => row.gross_pay))
    return { basePay, allowances: gross - basePay, source: 'payroll' }
  }
  const contract = findPayrollContractAsOf(db, cipher, settlement.company_id, settlement.employee_id, asOf)
  if (contract === undefined) return { basePay: 0, allowances: 0, source: 'contract' }
  const basePay = contract.base_salary > 0 ? contract.base_salary : contract.amount
  const allowances = sum(contract.payment_items.filter((item) => item.is_enabled).map((item) => item.amount))
  return { basePay, allowances, source: 'contract' }
}

function recalculate(db: DatabaseSync, settlement: SeveranceRow, input: SeveranceInputData, now: string): void {
  const wages = repo.listMonthlyWages(db, settlement.id)
  const result = calculateSeverancePay(
    {
      joinDate: settlement.service_start_date,
      lastWorkDate: settlement.base_date,
      threeMonthWages: sum(wages.map((wage) => wage.total)),
      threeMonthDays: sum(wages.map((wage) => wage.days)),
      ...(input.annual_bonus === undefined ? {} : { annualBonus: input.annual_bonus }),
      ...(input.annual_leave_pay === undefined ? {} : { annualLeavePay: input.annual_leave_pay }),
      ...(input.ordinary_daily_wage === undefined ? {} : { ordinaryDailyWage: input.ordinary_daily_wage }),
    },
    severanceRatesOf(db, settlement.base_date.slice(0, 7)),
  )
  repo.saveSettlementCalculation(db, settlement.company_id, settlement.id, input, result, now)
}

function severanceRatesOf(db: DatabaseSync, month: string): PayrollRateTable {
  const tables = loadRateTables(db)
  const table = tables.filter((candidate) => candidate.effectiveFrom <= month).at(-1) ?? tables[0]
  if (table === undefined) throw new Error('No payroll rate table is stored.')
  return table
}

function mirrorStatus(db: DatabaseSync, settlement: SeveranceRow, status: SeveranceStatus | null, now: string): void {
  if (settlement.kind === 'retirement') setSeveranceSettlementStatus(db, settlement.company_id, settlement.employee_id, status, now)
}

function serviceStartOf(db: DatabaseSync, companyId: string, employee: EmployeeRecord): PlainDate {
  const interim = latestCompletedInterim(db, companyId, employee.id)
  return interim === undefined ? (employee.joinDate as PlainDate) : addDays(interim.base_date, 1)
}

function latestCompletedInterim(db: DatabaseSync, companyId: string, employeeId: number): SeveranceRow | undefined {
  return repo
    .listSettlementsOfEmployee(db, companyId, employeeId)
    .filter((row) => row.kind === 'interim' && row.status === 'completed')
    .at(-1)
}

function assertLeaveAfterInterim(db: DatabaseSync, companyId: string, kind: SeveranceKind, employeeId: number): void {
  if (kind !== 'retirement') return
  const interim = latestCompletedInterim(db, companyId, employeeId)
  const employee = findEmployee(db, companyId, employeeId, interim?.base_date ?? ('2000-01-01' as PlainDate))
  const leaveDate = findRetirementInfo(db, companyId, employeeId)?.leave_date ?? employee?.leaveDate ?? null
  if (interim !== undefined && leaveDate !== null && leaveDate <= interim.base_date) {
    throw new PayrollError('LEAVE_DATE_BEFORE_INTERIM', 'The leave date is before the completed interim settlement date.')
  }
}

function defaultScheme(db: DatabaseSync, companyId: string): SeveranceRow['retirement_benefit_type'] {
  return findTerms(db, companyId)?.retirement_benefit_type ?? 'grant'
}
