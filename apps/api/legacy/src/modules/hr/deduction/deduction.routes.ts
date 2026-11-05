import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { requireEmployee } from '../employees/employee-guard'
import { countDependantsAsOf } from '../family/family.repository'
import type { DependantCounts } from '../family/family.types'
import type { HrContext } from '../shared/hr-context.types'
import { fromFlag } from '../shared/hr.utils'
import { findDeductionInfoAsOf, saveDeductionInfo } from './deduction.repository'
import { deductionBody } from './deduction.schema'
import type { DeductionInfoRow } from './deduction.types'
import { toDeductionWrite } from './deduction.utils'
import { INCOME_TAX_REDUCTION_REASONS } from './income-tax-reduction-reasons'

const PATH = '/employment/wage-employees/:employeeId{[0-9]+}/deduction-info'

/** Routes of an employee's income tax and other deduction settings, and the reduction reason codes. */
export function deductionRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  const respond = (companyId: string, employeeId: number): Record<string, unknown> => {
    const today = deps.clock.today()
    return serializeDeduction(findDeductionInfoAsOf(deps.db, companyId, employeeId, today), countDependantsAsOf(deps.db, companyId, employeeId, today))
  }

  return new Hono<AppEnv>()
    .get('/employment/wage-employees/income-tax-reduction-reasons', menu, (c) => c.json(INCOME_TAX_REDUCTION_REASONS))
    .get(PATH, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(respond(c.var.company.id, employee.id))
    })
    .put(PATH, menu, zValidator('json', deductionBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const { effective_date: effectiveDate, ...input } = c.req.valid('json')
      saveDeductionInfo(deps.db, employee.company_id, employee.id, effectiveDate ?? deps.clock.today(), toDeductionWrite(input), c.var.user.id, deps.clock.now())
      return c.json(respond(c.var.company.id, employee.id))
    })
}

function serializeDeduction(row: DeductionInfoRow | undefined, counts: DependantCounts): Record<string, unknown> {
  return {
    income_tax_calc_method: row?.income_tax_calc_method ?? 'tax_table_based',
    manual_income_tax: row?.manual_income_tax ?? null,
    income_tax_rate: row?.income_tax_rate ?? 100,
    income_tax_reduction_type: row?.income_tax_reduction_type ?? 'none',
    income_tax_reduction_application_type: row?.income_tax_reduction_application_type ?? '',
    income_tax_reduction_reason: row?.income_tax_reduction_reason ?? null,
    income_tax_reduction_start_date: row?.income_tax_reduction_start_date ?? null,
    income_tax_reduction_end_date: row?.income_tax_reduction_end_date ?? null,
    income_tax_reduction_rate: row?.income_tax_reduction_rate ?? null,
    income_tax_reduction_scope: row?.income_tax_reduction_scope ?? null,
    dependents_count: counts.dependents_count,
    children_8_to_20_count: counts.children_8_to_20_count,
    student_loan_applied: row === undefined ? false : fromFlag(row.student_loan_applied),
    student_loan_monthly_amount: row?.student_loan_monthly_amount ?? null,
    student_loan_start_date: row?.student_loan_start_date ?? null,
    student_loan_end_date: row?.student_loan_end_date ?? null,
    effective_from: row?.effective_from ?? null,
    updated: row?.updated_at ?? null,
  }
}
