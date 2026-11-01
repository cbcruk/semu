import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import type { Cipher } from '../../../lib/crypto/crypto.types'
import { invalidField, notFound } from '../../../lib/domain-error'
import { addMonths } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { findEmployeeDocument } from '../documents/documents.repository'
import type { EmployeeRow } from '../employees/employees.types'
import { toFlag } from '../shared/hr.utils'
import {
  deletePayrollContract,
  deleteWorkContract,
  findPayrollContract,
  findWorkContract,
  findWorkContractAsOf,
  insertPayrollContract,
  insertWorkContract,
  updatePayrollContract,
  updateWorkContract,
} from './contracts.repository'
import type { PayrollContractInput, PayrollContractRow, PayrollContractWrite, WageResult, WorkContractInput, WorkContractRow, WorkContractWrite } from './contracts.types'
import { calculateWage } from './contracts.utils'

/**
 * Validates work contract input and converts it to column values (rule R7).
 *
 * A probation pay rate below 100% needs a contract of one year or longer;
 * fixed-term contracts need an end date.
 *
 * @param origin How the contract was created and the e-sign request behind it, if any.
 */
export function toWorkContractWrite(
  input: WorkContractInput,
  origin: { creationMethod: WorkContractRow['creation_method']; eSignRequestId: number | null } = { creationMethod: 'manual', eSignRequestId: null },
): WorkContractWrite {
  if (input.contract_type === 'contract' && input.end_date === null) throw invalidField('end_date', 'Fixed-term contracts need an end date.')
  if (input.end_date !== null && input.end_date < input.start_date) throw invalidField('end_date', 'The end date must not be before the start date.')
  if (input.has_probation && input.probation_months === null) throw invalidField('probation_months', 'Enter the probation period in months.')
  const payRate = input.has_probation ? (input.probation_pay_rate ?? 100) : null
  if (payRate !== null && payRate < 100 && input.end_date !== null && addMonths(input.start_date, 12) > input.end_date) {
    throw invalidField('probation_pay_rate', 'Contracts shorter than one year cannot reduce probation pay.')
  }
  return {
    creation_method: origin.creationMethod,
    e_sign_request_id: origin.eSignRequestId,
    contract_type: input.contract_type,
    start_date: input.start_date,
    end_date: input.end_date,
    work_type: input.work_type,
    work_code: input.work_code,
    work_condition_id: input.work_condition,
    work_schedule_policy_id: input.work_schedule_policy,
    weekly_work_hours: input.weekly_work_hours,
    has_probation: toFlag(input.has_probation),
    probation_months: input.has_probation ? input.probation_months : null,
    probation_pay_rate: payRate,
    job_description: input.job_description,
    document_id: input.document,
  }
}

/**
 * Validates payroll contract input, computes the derived wages and converts it to column values.
 *
 * The probation pay rate comes from the work contract in force on the payroll contract's start date.
 *
 * @param existing The contract being replaced, whose account number is kept when a masked one is sent back.
 */
export function toPayrollContractWrite(
  deps: Pick<ServiceDeps, 'db' | 'cipher'>,
  employee: Pick<EmployeeRow, 'company_id' | 'id'>,
  input: PayrollContractInput,
  existing: PayrollContractRow | null,
  eSignRequestId: number | null = null,
): { values: PayrollContractWrite; wage: WageResult } {
  if (input.end_date !== null && input.end_date < input.start_date) throw invalidField('end_date', 'The end date must not be before the start date.')
  if (input.wage_type === 'daily' && input.daily_work_hours === null) throw invalidField('daily_work_hours', 'Enter the daily working hours.')
  if (input.has_bonus && input.bonus_amount === null) throw invalidField('bonus_amount', 'Enter the bonus amount.')
  const accountNumber = resolveAccountNumber(deps.cipher, input.account_number, existing)
  if (input.pay_method === 'transfer' && (input.bank_code === null || accountNumber === null || input.account_holder === null)) {
    throw invalidField('account_number', 'Bank transfers need a bank, account number and holder.')
  }
  const workContract = findWorkContractAsOf(deps.db, employee.company_id, employee.id, input.start_date)
  const wage = calculateWage({
    wageType: input.wage_type,
    amount: input.amount,
    monthlyWorkHours: input.monthly_work_hours,
    dailyWorkHours: input.daily_work_hours,
    paymentItems: input.payment_items,
    autoCalc: input.fixed_wage_auto_calc,
    fixed: {
      overtime: { enabled: input.fixed_overtime_enabled, hours: input.fixed_overtime_hours, amount: input.fixed_overtime_amount },
      night: { enabled: input.fixed_night_enabled, hours: input.fixed_night_hours, amount: input.fixed_night_amount },
      holiday: { enabled: input.fixed_holiday_enabled, hours: input.fixed_holiday_hours, amount: input.fixed_holiday_amount },
      holiday_overtime: {
        enabled: input.fixed_holiday_overtime_enabled,
        hours: input.fixed_holiday_overtime_hours,
        amount: input.fixed_holiday_overtime_amount,
      },
    },
    hasBonus: input.has_bonus,
    bonusAmount: input.bonus_amount,
    bonusInOrdinaryWage: input.bonus_in_ordinary_wage,
    probationPayRate: workContract?.has_probation === 1 ? workContract.probation_pay_rate : null,
  })
  if (wage.baseSalary < 0) throw invalidField('amount', 'Pay items and fixed allowances exceed the monthly wage.')
  const values: PayrollContractWrite = {
    e_sign_request_id: existing?.e_sign_request_id ?? eSignRequestId,
    start_date: input.start_date,
    end_date: input.end_date,
    wage_type: input.wage_type,
    monthly_work_hours_source: input.monthly_work_hours_source,
    monthly_work_hours: input.monthly_work_hours,
    daily_work_hours: input.daily_work_hours,
    amount: input.amount,
    payment_items: JSON.stringify(input.payment_items),
    fixed_wage_auto_calc: toFlag(input.fixed_wage_auto_calc),
    fixed_overtime_enabled: toFlag(input.fixed_overtime_enabled),
    fixed_overtime_hours: input.fixed_overtime_hours,
    fixed_overtime_amount: wage.fixedAmounts.overtime,
    fixed_night_enabled: toFlag(input.fixed_night_enabled),
    fixed_night_hours: input.fixed_night_hours,
    fixed_night_amount: wage.fixedAmounts.night,
    fixed_holiday_enabled: toFlag(input.fixed_holiday_enabled),
    fixed_holiday_hours: input.fixed_holiday_hours,
    fixed_holiday_amount: wage.fixedAmounts.holiday,
    fixed_holiday_overtime_enabled: toFlag(input.fixed_holiday_overtime_enabled),
    fixed_holiday_overtime_hours: input.fixed_holiday_overtime_hours,
    fixed_holiday_overtime_amount: wage.fixedAmounts.holiday_overtime,
    base_salary: wage.baseSalary,
    base_hourly_wage: wage.baseHourlyWage,
    probation_hourly_wage: wage.probationHourlyWage,
    ordinary_hourly_wage: wage.ordinaryHourlyWage,
    annual_salary: input.annual_salary,
    has_bonus: toFlag(input.has_bonus),
    bonus_amount: input.has_bonus ? input.bonus_amount : null,
    bonus_in_ordinary_wage: toFlag(input.has_bonus && input.bonus_in_ordinary_wage),
    pay_month: input.pay_month,
    pay_day: input.pay_day,
    pay_method: input.pay_method,
    bank_code: input.pay_method === 'transfer' ? input.bank_code : null,
    account_number_enc: input.pay_method === 'transfer' && accountNumber !== null ? deps.cipher.encrypt(accountNumber) : null,
    account_holder: input.pay_method === 'transfer' ? input.account_holder : null,
  }
  return { values, wage }
}

/** Creates a manual work contract. */
export function createWorkContract(deps: ServiceDeps, employee: EmployeeRow, input: WorkContractInput): WorkContractRow {
  return transaction(deps.db, () => {
    assertDocument(deps, employee, input.document)
    const id = insertWorkContract(deps.db, employee.company_id, employee.id, toWorkContractWrite(input), deps.clock.now())
    return requireWorkContract(deps, employee, id)
  })
}

/** Replaces a work contract, keeping how it was created. */
export function replaceWorkContract(deps: ServiceDeps, employee: EmployeeRow, contractId: number, input: WorkContractInput): WorkContractRow {
  return transaction(deps.db, () => {
    const current = requireWorkContract(deps, employee, contractId)
    assertDocument(deps, employee, input.document)
    const values = toWorkContractWrite(input, { creationMethod: current.creation_method, eSignRequestId: current.e_sign_request_id })
    updateWorkContract(deps.db, employee.company_id, contractId, values, deps.clock.now())
    return requireWorkContract(deps, employee, contractId)
  })
}

/** Deletes a work contract. */
export function removeWorkContract(deps: ServiceDeps, employee: EmployeeRow, contractId: number): void {
  if (!deleteWorkContract(deps.db, employee.company_id, employee.id, contractId)) throw notFound('Work contract')
}

/** Creates a payroll contract. */
export function createPayrollContract(deps: ServiceDeps, employee: EmployeeRow, input: PayrollContractInput): { contract: PayrollContractRow; wage: WageResult } {
  return transaction(deps.db, () => {
    const { values, wage } = toPayrollContractWrite(deps, employee, input, null)
    const id = insertPayrollContract(deps.db, employee.company_id, employee.id, values, deps.clock.now())
    return { contract: requirePayrollContract(deps, employee, id), wage }
  })
}

/** Replaces a payroll contract. */
export function replacePayrollContract(
  deps: ServiceDeps,
  employee: EmployeeRow,
  contractId: number,
  input: PayrollContractInput,
): { contract: PayrollContractRow; wage: WageResult } {
  return transaction(deps.db, () => {
    const current = requirePayrollContract(deps, employee, contractId)
    const { values, wage } = toPayrollContractWrite(deps, employee, input, current)
    updatePayrollContract(deps.db, employee.company_id, contractId, values, deps.clock.now())
    return { contract: requirePayrollContract(deps, employee, contractId), wage }
  })
}

/** Deletes a payroll contract. */
export function removePayrollContract(deps: ServiceDeps, employee: EmployeeRow, contractId: number): void {
  if (!deletePayrollContract(deps.db, employee.company_id, employee.id, contractId)) throw notFound('Payroll contract')
}

/** Loads a work contract of the employee or fails with `NOT_FOUND`. */
export function requireWorkContract(deps: ServiceDeps, employee: EmployeeRow, contractId: number): WorkContractRow {
  const contract = findWorkContract(deps.db, employee.company_id, employee.id, contractId)
  if (contract === undefined) throw notFound('Work contract')
  return contract
}

/** Loads a payroll contract of the employee or fails with `NOT_FOUND`. */
export function requirePayrollContract(deps: ServiceDeps, employee: EmployeeRow, contractId: number): PayrollContractRow {
  const contract = findPayrollContract(deps.db, employee.company_id, employee.id, contractId)
  if (contract === undefined) throw notFound('Payroll contract')
  return contract
}

/** Recomputes the minimum-wage verdict of a stored payroll contract for responses. */
export function storedWageVerdict(contract: PayrollContractRow, probationPayRate: number | null): WageResult {
  return calculateWage({
    wageType: contract.wage_type,
    amount: contract.amount,
    monthlyWorkHours: contract.monthly_work_hours,
    dailyWorkHours: contract.daily_work_hours,
    paymentItems: JSON.parse(contract.payment_items) as PayrollContractInput['payment_items'],
    autoCalc: false,
    fixed: {
      overtime: { enabled: contract.fixed_overtime_enabled === 1, hours: contract.fixed_overtime_hours, amount: contract.fixed_overtime_amount },
      night: { enabled: contract.fixed_night_enabled === 1, hours: contract.fixed_night_hours, amount: contract.fixed_night_amount },
      holiday: { enabled: contract.fixed_holiday_enabled === 1, hours: contract.fixed_holiday_hours, amount: contract.fixed_holiday_amount },
      holiday_overtime: {
        enabled: contract.fixed_holiday_overtime_enabled === 1,
        hours: contract.fixed_holiday_overtime_hours,
        amount: contract.fixed_holiday_overtime_amount,
      },
    },
    hasBonus: contract.has_bonus === 1,
    bonusAmount: contract.bonus_amount,
    bonusInOrdinaryWage: contract.bonus_in_ordinary_wage === 1,
    probationPayRate,
  })
}

/** Returns the probation pay rate of the work contract in force on a date, or `null` without probation. */
export function probationRateOn(deps: Pick<ServiceDeps, 'db'>, employee: Pick<EmployeeRow, 'company_id' | 'id'>, date: PlainDate): number | null {
  const contract = findWorkContractAsOf(deps.db, employee.company_id, employee.id, date)
  return contract?.has_probation === 1 ? contract.probation_pay_rate : null
}

function resolveAccountNumber(cipher: Cipher, raw: string | null | undefined, existing: PayrollContractRow | null): string | null {
  if (raw === undefined || (raw !== null && raw.includes('*'))) {
    return existing?.account_number_enc == null ? null : cipher.decrypt(existing.account_number_enc)
  }
  if (raw === null || raw === '') return null
  const digits = raw.replace(/[\s-]/g, '')
  if (!/^\d{6,20}$/.test(digits)) throw invalidField('account_number', 'Enter digits only.')
  return digits
}

function assertDocument(deps: ServiceDeps, employee: EmployeeRow, documentId: number | null): void {
  if (documentId !== null && findEmployeeDocument(deps.db, employee.company_id, employee.id, documentId) === undefined) {
    throw invalidField('document', 'Unknown document.')
  }
}
