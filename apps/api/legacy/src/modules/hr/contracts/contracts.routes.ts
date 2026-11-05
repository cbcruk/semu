import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import type { Cipher } from '../../../lib/crypto/crypto.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { maskTail } from '../../../lib/masking'
import type { PlainDate } from '../../../lib/plain-date.types'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { parseId, requireEmployee } from '../employees/employee-guard'
import type { HrContext } from '../shared/hr-context.types'
import { pageQuery } from '../shared/hr.schema'
import { fromFlag } from '../shared/hr.utils'
import { listPayrollContracts, listWorkContracts } from './contracts.repository'
import { payrollContractBody, workContractBody } from './contracts.schema'
import {
  createPayrollContract,
  createWorkContract,
  probationRateOn,
  removePayrollContract,
  removeWorkContract,
  replacePayrollContract,
  replaceWorkContract,
  requirePayrollContract,
  requireWorkContract,
  storedWageVerdict,
} from './contracts.service'
import type { PaymentItemValue, PayrollContractRow, WageResult, WorkContractRow } from './contracts.types'
import { indefiniteConversionAlert, MINIMUM_HOURLY_WAGE_2026, workContractStatus } from './contracts.utils'

const EMPLOYEE = '/employment/wage-employees/:employeeId{[0-9]+}'
const WORK = `${EMPLOYEE}/work-contracts`
const WORK_ONE = `${WORK}/:contractId{[0-9]+}`
const PAYROLL = `${EMPLOYEE}/payroll-contracts`
const PAYROLL_ONE = `${PAYROLL}/:contractId{[0-9]+}`

/** Routes of an employee's work contracts (근로 정보), payroll contracts (급여 정보) and the two-year conversion alert. */
export function contractRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  const workBody = (contract: WorkContractRow): Record<string, unknown> => serializeWorkContract(contract, deps.clock.today())
  const payrollBody = (contract: PayrollContractRow, wage?: WageResult): Record<string, unknown> =>
    serializePayrollContract(
      contract,
      wage ?? storedWageVerdict(contract, probationRateOn(deps, { company_id: contract.company_id, id: contract.employee_id }, contract.start_date as PlainDate)),
      deps.cipher,
    )

  return new Hono<AppEnv>()
    .get(`${WORK}/indefinite-conversion-alert`, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(indefiniteConversionAlert(listWorkContracts(deps.db, c.var.company.id, employee.id), employee.birth_date, deps.clock.today()))
    })
    .get(WORK, menu, zValidator('query', pageQuery, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const all = listWorkContracts(deps.db, c.var.company.id, employee.id).reverse()
      return c.json(toPage(all.slice(page.offset, page.offset + page.limit).map(workBody), all.length, page, c.req.url))
    })
    .post(WORK, menu, zValidator('json', workContractBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(workBody(createWorkContract(deps, employee, c.req.valid('json'))), 201)
    })
    .get(WORK_ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(workBody(requireWorkContract(deps, employee, parseId(c.req.param('contractId'), 'Work contract'))))
    })
    .put(WORK_ONE, menu, zValidator('json', workContractBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(workBody(replaceWorkContract(deps, employee, parseId(c.req.param('contractId'), 'Work contract'), c.req.valid('json'))))
    })
    .delete(WORK_ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      removeWorkContract(deps, employee, parseId(c.req.param('contractId'), 'Work contract'))
      return c.body(null, 204)
    })
    .get(PAYROLL, menu, zValidator('query', pageQuery, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const all = listPayrollContracts(deps.db, c.var.company.id, employee.id)
      return c.json(toPage(all.slice(page.offset, page.offset + page.limit).map((row) => payrollBody(row)), all.length, page, c.req.url))
    })
    .post(PAYROLL, menu, zValidator('json', payrollContractBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const { contract, wage } = createPayrollContract(deps, employee, c.req.valid('json'))
      return c.json(payrollBody(contract, wage), 201)
    })
    .get(PAYROLL_ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(payrollBody(requirePayrollContract(deps, employee, parseId(c.req.param('contractId'), 'Payroll contract'))))
    })
    .put(PAYROLL_ONE, menu, zValidator('json', payrollContractBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const { contract, wage } = replacePayrollContract(deps, employee, parseId(c.req.param('contractId'), 'Payroll contract'), c.req.valid('json'))
      return c.json(payrollBody(contract, wage))
    })
    .delete(PAYROLL_ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      removePayrollContract(deps, employee, parseId(c.req.param('contractId'), 'Payroll contract'))
      return c.body(null, 204)
    })
}

/** Serialises a work contract with its computed status. */
export function serializeWorkContract(contract: WorkContractRow, today: PlainDate): Record<string, unknown> {
  return {
    id: contract.id,
    creation_method: contract.creation_method,
    e_sign_request: contract.e_sign_request_id,
    contract_type: contract.contract_type,
    start_date: contract.start_date,
    end_date: contract.end_date,
    status: workContractStatus(contract, today),
    work_type: contract.work_type,
    work_code: contract.work_code,
    work_condition: contract.work_condition_id,
    work_schedule_policy: contract.work_schedule_policy_id,
    weekly_work_hours: contract.weekly_work_hours,
    has_probation: fromFlag(contract.has_probation),
    probation_months: contract.probation_months,
    probation_pay_rate: contract.probation_pay_rate,
    job_description: contract.job_description,
    document: contract.document_id,
    created: contract.created_at,
    updated: contract.updated_at,
  }
}

/** Serialises a payroll contract with derived wages, the minimum wage verdict and a masked account number. */
export function serializePayrollContract(contract: PayrollContractRow, wage: WageResult, cipher: Cipher): Record<string, unknown> {
  return {
    id: contract.id,
    e_sign_request: contract.e_sign_request_id,
    start_date: contract.start_date,
    end_date: contract.end_date,
    wage_type: contract.wage_type,
    monthly_work_hours_source: contract.monthly_work_hours_source,
    monthly_work_hours: contract.monthly_work_hours,
    daily_work_hours: contract.daily_work_hours,
    amount: contract.amount,
    base_salary: contract.base_salary,
    base_hourly_wage: contract.base_hourly_wage,
    probation_hourly_wage: contract.probation_hourly_wage,
    ordinary_hourly_wage: contract.ordinary_hourly_wage,
    payment_items: JSON.parse(contract.payment_items) as PaymentItemValue[],
    fixed_wage_auto_calc: fromFlag(contract.fixed_wage_auto_calc),
    fixed_overtime_enabled: fromFlag(contract.fixed_overtime_enabled),
    fixed_overtime_hours: contract.fixed_overtime_hours,
    fixed_overtime_amount: contract.fixed_overtime_amount,
    fixed_night_enabled: fromFlag(contract.fixed_night_enabled),
    fixed_night_hours: contract.fixed_night_hours,
    fixed_night_amount: contract.fixed_night_amount,
    fixed_holiday_enabled: fromFlag(contract.fixed_holiday_enabled),
    fixed_holiday_hours: contract.fixed_holiday_hours,
    fixed_holiday_amount: contract.fixed_holiday_amount,
    fixed_holiday_overtime_enabled: fromFlag(contract.fixed_holiday_overtime_enabled),
    fixed_holiday_overtime_hours: contract.fixed_holiday_overtime_hours,
    fixed_holiday_overtime_amount: contract.fixed_holiday_overtime_amount,
    annual_salary: contract.annual_salary,
    has_bonus: fromFlag(contract.has_bonus),
    bonus_amount: contract.bonus_amount,
    bonus_in_ordinary_wage: fromFlag(contract.bonus_in_ordinary_wage),
    pay_month: contract.pay_month,
    pay_day: contract.pay_day,
    pay_method: contract.pay_method,
    bank_code: contract.bank_code,
    account_number: contract.account_number_enc === null ? null : maskTail(cipher.decrypt(contract.account_number_enc), 4),
    account_holder: contract.account_holder,
    minimum_wage: { hourly: MINIMUM_HOURLY_WAGE_2026, contract_hourly: wage.minimumWageHourly, is_below: wage.isBelowMinimumWage },
    created: contract.created_at,
    updated: contract.updated_at,
  }
}
