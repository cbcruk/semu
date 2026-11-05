import type { z } from 'zod'
import type { payrollContractBody, workContractBody } from './contracts.schema'

/** Parsed body of `POST`/`PUT work-contracts`. */
export type WorkContractInput = z.infer<typeof workContractBody>

/** Parsed body of `POST`/`PUT payroll-contracts`. */
export type PayrollContractInput = z.infer<typeof payrollContractBody>

/** Computed state of a work contract on a date. */
export type WorkContractStatus = 'scheduled' | 'active' | 'expired'

/** A row of `employee_work_contracts`. */
export interface WorkContractRow {
  id: number
  company_id: string
  employee_id: number
  creation_method: 'manual' | 'esign'
  e_sign_request_id: number | null
  contract_type: 'regular' | 'contract'
  start_date: string
  end_date: string | null
  work_type: 'regular' | 'part_time' | 'short_time'
  work_code: string | null
  work_condition_id: number | null
  work_schedule_policy_id: number | null
  weekly_work_hours: number | null
  has_probation: 0 | 1
  probation_months: number | null
  probation_pay_rate: number | null
  job_description: string | null
  document_id: number | null
  created_at: string
  updated_at: string
}

/** Values written to a work contract. */
export type WorkContractWrite = Omit<WorkContractRow, 'id' | 'company_id' | 'employee_id' | 'created_at' | 'updated_at'>

/** A pay item enabled on a payroll contract, referring to the company's payroll settings. */
export interface PaymentItemValue {
  payment_item: number | string
  name?: string | undefined
  is_enabled: boolean
  amount: number
  /** Whether the item is part of 통상임금; assumed `true` when the client does not say. */
  is_ordinary_wage?: boolean | undefined
  /** Whether the item counts toward the minimum wage test; assumed `true` when the client does not say. */
  counts_toward_minimum_wage?: boolean | undefined
}

/** One kind of fixed allowance under 고정임금제. */
export type FixedAllowanceKind = 'overtime' | 'night' | 'holiday' | 'holiday_overtime'

/** A row of `employee_payroll_contracts`, with the account number still encrypted. */
export interface PayrollContractRow {
  id: number
  company_id: string
  employee_id: number
  e_sign_request_id: number | null
  start_date: string
  end_date: string | null
  wage_type: 'monthly' | 'daily' | 'hourly'
  monthly_work_hours_source: 'policy' | 'manual'
  monthly_work_hours: number
  daily_work_hours: number | null
  amount: number
  payment_items: string
  fixed_wage_auto_calc: 0 | 1
  fixed_overtime_enabled: 0 | 1
  fixed_overtime_hours: number
  fixed_overtime_amount: number
  fixed_night_enabled: 0 | 1
  fixed_night_hours: number
  fixed_night_amount: number
  fixed_holiday_enabled: 0 | 1
  fixed_holiday_hours: number
  fixed_holiday_amount: number
  fixed_holiday_overtime_enabled: 0 | 1
  fixed_holiday_overtime_hours: number
  fixed_holiday_overtime_amount: number
  base_salary: number
  base_hourly_wage: number
  probation_hourly_wage: number | null
  ordinary_hourly_wage: number
  annual_salary: number | null
  has_bonus: 0 | 1
  bonus_amount: number | null
  bonus_in_ordinary_wage: 0 | 1
  pay_month: 'current' | 'next'
  pay_day: number
  pay_method: 'transfer' | 'direct'
  bank_code: string | null
  account_number_enc: string | null
  account_holder: string | null
  created_at: string
  updated_at: string
}

/** Values written to a payroll contract. */
export type PayrollContractWrite = Omit<PayrollContractRow, 'id' | 'company_id' | 'employee_id' | 'created_at' | 'updated_at'>

/** The input of the wage calculation, before derived amounts are known. */
export interface WageInput {
  wageType: 'monthly' | 'daily' | 'hourly'
  amount: number
  monthlyWorkHours: number
  dailyWorkHours: number | null
  paymentItems: PaymentItemValue[]
  autoCalc: boolean
  fixed: Record<FixedAllowanceKind, { enabled: boolean; hours: number; amount: number }>
  hasBonus: boolean
  bonusAmount: number | null
  bonusInOrdinaryWage: boolean
  probationPayRate: number | null
}

/** Derived wage values the server computes for a payroll contract. */
export interface WageResult {
  baseSalary: number
  baseHourlyWage: number
  ordinaryHourlyWage: number
  probationHourlyWage: number | null
  fixedAmounts: Record<FixedAllowanceKind, number>
  /** Hourly wage counted for the minimum wage test. */
  minimumWageHourly: number
  isBelowMinimumWage: boolean
}

/** A payroll contract as payroll reads it, with the account number decrypted. */
export interface PayrollContractRecord extends Omit<PayrollContractRow, 'account_number_enc' | 'payment_items'> {
  account_number: string | null
  payment_items: PaymentItemValue[]
}

/** The result of the two-year fixed-term check (기간제법 제4조). */
export interface IndefiniteConversionAlert {
  is_target: boolean
  status: 'none' | 'approaching' | 'exceeded'
  is_exempt: boolean
  exempt_reason: 'aged_55_or_over' | null
  chain_start_date: string | null
  chain_end_date: string | null
  total_contract_days: number
  conversion_date: string | null
  days_until_conversion: number | null
}
