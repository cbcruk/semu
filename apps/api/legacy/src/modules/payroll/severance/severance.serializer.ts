import type { SeveranceResult } from '../engine/engine.types'
import { parseJsonColumn } from '../cards/cards.utils'
import type { SeveranceCandidate } from './severance.service'
import type { MonthlyWageRow, SeveranceInputData, SeveranceRow } from './severance.types'

/** Serializes a settlement, with its monthly wages when they are given. */
export function serializeSettlement(row: SeveranceRow, wages?: readonly MonthlyWageRow[]): Record<string, unknown> {
  const result = parseJsonColumn<SeveranceResult | null>(row.result, null)
  const input = parseJsonColumn<SeveranceInputData>(row.input, {})
  return {
    id: row.id,
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    kind: row.kind,
    status: row.status,
    interim_reason: row.interim_reason,
    join_date: row.join_date,
    service_start_date: row.service_start_date,
    base_date: row.base_date,
    leave_date: row.kind === 'retirement' ? row.base_date : null,
    interim_settlement_date: row.kind === 'interim' ? row.base_date : null,
    retirement_benefit_type: row.retirement_benefit_type,
    payment_date: row.payment_date,
    annual_bonus: input.annual_bonus ?? 0,
    annual_leave_pay: input.annual_leave_pay ?? 0,
    ordinary_daily_wage: input.ordinary_daily_wage ?? null,
    eligible: result?.eligible ?? false,
    service_days: row.service_days,
    average_daily_wage: row.average_daily_wage,
    used_ordinary_wage: result?.usedOrdinaryWage ?? false,
    severance_pay: row.severance_pay,
    retirement_income_tax: row.retirement_income_tax,
    local_income_tax: row.local_income_tax,
    net_pay: row.net_pay,
    exclude_reason: row.exclude_reason,
    completed_at: row.completed_at,
    version: row.version,
    breakdown: result?.breakdown ?? [],
    ...(wages === undefined ? {} : { monthly_wages: wages.map(serializeMonthlyWage), three_month_wages: wages.reduce((total, wage) => total + wage.total, 0) }),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Serializes one month of the average-wage base. */
export function serializeMonthlyWage(row: MonthlyWageRow): Record<string, unknown> {
  return {
    id: row.id,
    month: row.month,
    period_start: row.period_start,
    period_end: row.period_end,
    days: row.days,
    base_pay: row.base_pay,
    allowances: row.allowances,
    total: row.total,
    source: row.source,
  }
}

/** Serializes a retirement or interim candidate. */
export function serializeCandidate(candidate: SeveranceCandidate): Record<string, unknown> {
  return {
    employee_id: candidate.employee.id,
    name: candidate.employee.name,
    department: candidate.employee.departmentName,
    position: candidate.employee.positionName,
    join_date: candidate.employee.joinDate,
    leave_date: candidate.employee.leaveDate,
    service_start_date: candidate.serviceStartDate,
    base_date: candidate.baseDate,
    service_days: candidate.serviceDays,
    retirement_benefit_type: candidate.retirementBenefitType,
  }
}
