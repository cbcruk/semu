import type { PlainDate } from '../../../lib/plain-date.types'
import type { SeveranceResult } from '../engine/engine.types'
import type { YearMonth } from '../engine/rate-table.types'

/** Kind of a severance settlement: on retirement or an interim settlement (중간정산). */
export type SeveranceKind = 'retirement' | 'interim'

/** `SEVERANCE_SETTLEMENT_STATUS`. */
export type SeveranceStatus = 'in_progress' | 'completed' | 'excluded'

/** `SEVERANCE_EARLY_SETT_REASON`: the nine legal grounds of an interim settlement. */
export type InterimReason =
  | 'home_purchase'
  | 'rent_deposit'
  | 'medical_treatment'
  | 'bankruptcy'
  | 'personal_rehabilitation'
  | 'wage_peak'
  | 'work_hours_reduction'
  | 'legal_work_hours_reduction'
  | 'etc_gov_notice'

/** Every interim reason, in the bundle's order. */
export const INTERIM_REASONS: readonly InterimReason[] = [
  'home_purchase',
  'rent_deposit',
  'medical_treatment',
  'bankruptcy',
  'personal_rehabilitation',
  'wage_peak',
  'work_hours_reduction',
  'legal_work_hours_reduction',
  'etc_gov_notice',
]

/** Amounts the agency enters on a settlement (`temp-save`, `complete`). */
export interface SeveranceInputData {
  annual_bonus?: number
  annual_leave_pay?: number
  ordinary_daily_wage?: number
  payment_date?: PlainDate
}

/** Row of `severance_settlements`. */
export interface SeveranceRow {
  id: number
  company_id: string
  employee_id: number
  employee_name: string
  kind: SeveranceKind
  status: SeveranceStatus
  interim_reason: InterimReason | null
  join_date: PlainDate
  service_start_date: PlainDate
  base_date: PlainDate
  retirement_benefit_type: 'grant' | 'pension_db' | 'pension_dc'
  payment_date: PlainDate | null
  input: string
  result: string | null
  service_days: number
  average_daily_wage: number
  severance_pay: number
  retirement_income_tax: number
  local_income_tax: number
  net_pay: number
  exclude_reason: string | null
  completed_at: string | null
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Row of `severance_monthly_wages`: one month of the three-month average wage base. */
export interface MonthlyWageRow {
  id: number
  settlement_id: number
  month: YearMonth
  period_start: PlainDate
  period_end: PlainDate
  days: number
  base_pay: number
  allowances: number
  total: number
  source: 'payroll' | 'contract' | 'manual'
}

/** A monthly wage before it is stored. */
export type MonthlyWageWrite = Omit<MonthlyWageRow, 'id' | 'settlement_id'>

/** A settlement's stored engine result. */
export type StoredSeveranceResult = SeveranceResult
