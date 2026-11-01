import type { DatabaseSync } from 'node:sqlite'
import type { PlainDate } from '../../../lib/plain-date.types'
import { insertPayrollContract, insertWorkContract } from '../contracts/contracts.repository'
import type { PayrollContractWrite, WorkContractWrite } from '../contracts/contracts.types'
import { calculateWage } from '../contracts/contracts.utils'
import { insertEmployeeDocument } from '../documents/documents.repository'
import { findEmployeeRow, insertEmployee } from '../employees/employees.repository'
import { draftLeavingReason } from '../retirement/retirement.repository'
import { findBaseTemplate } from './base-templates'
import { linkRecipientEmployee } from './e-sign-requests.repository'
import type { CompleteInput, DocumentKind, ESignRequestAggregate, FieldValueMap } from './e-sign.types'
import { numberValue, stringValue } from './e-sign.utils'

const WAGE_CONTRACT_KINDS: readonly DocumentKind[] = ['employment_contract', 'part_time_employment_contract', 'annual_salary_contract']

/** What signing a request changed in the HR records. */
export interface CompletionEffects {
  employeeId: number | null
  createdEmployee: boolean
  workContractIds: number[]
  payrollContractIds: number[]
  documentId: number | null
}

/**
 * Applies the follow-up effects of a completed signature (rule R29) inside the completion transaction.
 *
 * - Employment and annual salary contracts create a work contract
 *   (`creation_method = esign`) and, when a wage is given, a payroll contract
 *   for the recipient's wage employee. A recipient who is not yet an employee
 *   becomes a wage employee with no registration number, which the list flags
 *   as missing required information.
 * - The signed PDF is filed in the employee's document box.
 * - A resignation letter drafts the leaving reason on the retirement record.
 */
export function applyCompletionEffects(
  db: DatabaseSync,
  aggregate: ESignRequestAggregate,
  input: CompleteInput,
  result: { fileId: string; fileName: string },
  today: PlainDate,
  now: string,
): CompletionEffects {
  const { request, recipient, documents } = aggregate
  const adminValues = JSON.parse(request.field_values) as FieldValueMap
  const valuesOf = (index: number): Record<string, unknown> => ({
    ...(adminValues[String(index)] ?? {}),
    ...(input.documents.find((document) => document.index === index)?.field_values ?? {}),
  })
  const effects: CompletionEffects = { employeeId: recipient.employee_id, createdEmployee: false, workContractIds: [], payrollContractIds: [], documentId: null }
  const wageDocuments = documents.filter((document) => WAGE_CONTRACT_KINDS.includes(document.document_kind))
  const isWageRecipient = recipient.employment_type === 'wageemployee' || recipient.employment_type === null
  if (effects.employeeId === null && isWageRecipient && wageDocuments.length > 0) {
    const first = wageDocuments[0]
    const values = first === undefined ? {} : valuesOf(first.doc_index)
    effects.employeeId = insertEmployee(
      db,
      request.company_id,
      'wage-salary',
      {
        name: recipient.name,
        english_name: null,
        registration_number_enc: null,
        registration_number_hash: null,
        identification_number_type: 'registration',
        birth_date: recipient.birth_date,
        email: recipient.email,
        phone: recipient.phone,
        is_local: recipient.is_local,
        nationality: recipient.nationality,
        visa: recipient.visa,
        is_residence: 1,
        country_of_residence: '대한민국',
        employee_number: null,
        department_id: null,
        position_id: null,
        join_date: stringValue(values, 'join_date') ?? stringValue(values, 'contract_start_date') ?? today,
        work_code: null,
        is_rejoin: 0,
      },
      'e_sign',
      request.created_by,
      now,
    )
    effects.createdEmployee = true
    linkRecipientEmployee(db, request.company_id, request.id, effects.employeeId)
  }
  const employee = effects.employeeId === null ? undefined : findEmployeeRow(db, request.company_id, effects.employeeId)
  if (employee === undefined) return effects
  const firstDocument = documents[0]
  effects.documentId = insertEmployeeDocument(db, {
    companyId: request.company_id,
    employeeId: employee.id,
    category: firstDocument?.category ?? 'contract',
    sourceType: 'e_sign',
    sourceId: request.id,
    fileId: result.fileId,
    fileName: result.fileName,
    createdBy: request.created_by,
    now,
  })
  if (employee.kind === 'wage-salary') {
    for (const document of wageDocuments) {
      const values = valuesOf(document.doc_index)
      const start = stringValue(values, 'contract_start_date') ?? stringValue(values, 'join_date') ?? employee.join_date ?? today
      const end = stringValue(values, 'contract_end_date')
      const contractType = documentContractType(document.template_id, end)
      if (document.document_kind !== 'annual_salary_contract') {
        effects.workContractIds.push(
          insertWorkContract(db, request.company_id, employee.id, workContractValues(request.id, effects.documentId, contractType, start, end, document.document_kind, values, aggregate), now),
        )
      }
      const payroll = payrollContractValues(request.id, start, end, values, request.wage_type)
      if (payroll !== null) effects.payrollContractIds.push(insertPayrollContract(db, request.company_id, employee.id, payroll, now))
    }
    if (documents.some((document) => document.document_kind === 'resignation') && input.leaving_reason !== undefined) {
      draftLeavingReason(db, request.company_id, employee.id, input.leaving_reason, input.leaving_detail_reason ?? null, now)
    }
  }
  return effects
}

function documentContractType(templateId: number, end: string | null): 'regular' | 'contract' {
  return findBaseTemplate(templateId)?.contract_type === 'contract' && end !== null ? 'contract' : 'regular'
}

function workContractValues(
  requestId: number,
  documentId: number | null,
  contractType: 'regular' | 'contract',
  start: string,
  end: string | null,
  kind: DocumentKind,
  values: Record<string, unknown>,
  aggregate: ESignRequestAggregate,
): WorkContractWrite {
  const probationMonths = numberValue(values, 'probation_months')
  const hidden = Array.isArray(values['__hidden']) ? (values['__hidden'] as unknown[]) : []
  const hasProbation = probationMonths !== null && probationMonths > 0 && !hidden.includes('probation_months')
  const rate = numberValue(values, 'probation_pay_rate')
  return {
    creation_method: 'esign',
    e_sign_request_id: requestId,
    contract_type: contractType,
    start_date: start,
    end_date: contractType === 'contract' ? end : null,
    work_type: kind === 'part_time_employment_contract' ? 'part_time' : 'regular',
    work_code: null,
    work_condition_id: aggregate.request.work_condition_id,
    work_schedule_policy_id: aggregate.request.work_schedule_policy_id,
    weekly_work_hours: numberValue(values, 'weekly_work_hours'),
    has_probation: hasProbation ? 1 : 0,
    probation_months: hasProbation ? Math.min(12, Math.max(1, Math.round(probationMonths))) : null,
    probation_pay_rate: hasProbation ? Math.min(100, Math.max(90, Math.round(rate ?? 100))) : null,
    job_description: stringValue(values, 'job_description'),
    document_id: documentId,
  }
}

function payrollContractValues(
  requestId: number,
  start: string,
  end: string | null,
  values: Record<string, unknown>,
  wageType: 'monthly' | 'daily' | 'hourly' | null,
): PayrollContractWrite | null {
  const monthly = numberValue(values, 'monthly_wage')
  const annual = numberValue(values, 'annual_salary')
  const amount = monthly ?? (annual === null ? null : Math.round(annual / 12))
  if (amount === null) return null
  const hours = numberValue(values, 'monthly_work_hours') ?? 209
  const off = { enabled: false, hours: 0, amount: 0 }
  const type = wageType ?? 'monthly'
  const wage = calculateWage({
    wageType: type,
    amount: Math.round(amount),
    monthlyWorkHours: hours,
    dailyWorkHours: null,
    paymentItems: [],
    autoCalc: false,
    fixed: { overtime: off, night: off, holiday: off, holiday_overtime: off },
    hasBonus: false,
    bonusAmount: null,
    bonusInOrdinaryWage: false,
    probationPayRate: numberValue(values, 'probation_pay_rate'),
  })
  return {
    e_sign_request_id: requestId,
    start_date: start,
    end_date: end,
    wage_type: type,
    monthly_work_hours_source: 'manual',
    monthly_work_hours: hours,
    daily_work_hours: null,
    amount: Math.round(amount),
    payment_items: '[]',
    fixed_wage_auto_calc: 0,
    fixed_overtime_enabled: 0,
    fixed_overtime_hours: 0,
    fixed_overtime_amount: 0,
    fixed_night_enabled: 0,
    fixed_night_hours: 0,
    fixed_night_amount: 0,
    fixed_holiday_enabled: 0,
    fixed_holiday_hours: 0,
    fixed_holiday_amount: 0,
    fixed_holiday_overtime_enabled: 0,
    fixed_holiday_overtime_hours: 0,
    fixed_holiday_overtime_amount: 0,
    base_salary: wage.baseSalary,
    base_hourly_wage: wage.baseHourlyWage,
    probation_hourly_wage: wage.probationHourlyWage,
    ordinary_hourly_wage: wage.ordinaryHourlyWage,
    annual_salary: annual === null ? null : Math.round(annual),
    has_bonus: 0,
    bonus_amount: null,
    bonus_in_ordinary_wage: 0,
    pay_month: 'current',
    pay_day: 25,
    pay_method: 'transfer',
    bank_code: null,
    account_number_enc: null,
    account_holder: null,
  }
}
