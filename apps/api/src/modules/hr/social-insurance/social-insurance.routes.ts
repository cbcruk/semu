import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppEnv, ServiceDeps } from '../../../app.types'
import type { PlainDate } from '../../../lib/plain-date.types'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { findWorkContractAsOf } from '../contracts/contracts.repository'
import { requireEmployee } from '../employees/employee-guard'
import type { EmployeeRow } from '../employees/employees.types'
import type { HrContext } from '../shared/hr-context.types'
import { findSocialInsuranceAsOf, saveSocialInsurance } from './social-insurance.repository'
import { socialInsuranceBody, socialInsurancePreviewBody } from './social-insurance.schema'
import type { DeterminationFacts, DeterminationResult, SocialInsuranceRow, SocialInsuranceSettings } from './social-insurance.types'
import { determineSocialInsurance, toSettings } from './social-insurance.utils'

const PATH = '/employment/wage-employees/:employeeId{[0-9]+}/social-insurance-info'

/** Routes of an employee's 4대보험 settings, the unsaved-form preview and server redetermination. */
export function socialInsuranceRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  const current = (employee: EmployeeRow): { row: SocialInsuranceRow | undefined; settings: SocialInsuranceSettings; result: DeterminationResult } => {
    const today = deps.clock.today()
    const row = findSocialInsuranceAsOf(deps.db, employee.company_id, employee.id, today)
    const settings = toSettings(row)
    return { row, settings, result: determineSocialInsurance(factsOf(deps, employee, today), settings, today) }
  }

  return new Hono<AppEnv>()
    .get(PATH, menu, (c) => {
      const { row, settings, result } = current(requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId')))
      return c.json(serialize(row, settings, result))
    })
    .put(PATH, menu, zValidator('json', socialInsuranceBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const { effective_date: effectiveDate, ...settings } = c.req.valid('json')
      saveSocialInsurance(deps.db, employee.company_id, employee.id, effectiveDate ?? deps.clock.today(), settings, c.var.user.id, deps.clock.now())
      const { row, settings: saved, result } = current(employee)
      return c.json(serialize(row, saved, result))
    })
    .post(`${PATH}/preview`, menu, zValidator('json', socialInsurancePreviewBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const body = c.req.valid('json')
      const today = deps.clock.today()
      const base = factsOf(deps, employee, today)
      const facts: DeterminationFacts = {
        birthDate: body.birth_date ?? base.birthDate,
        joinDate: body.join_date ?? base.joinDate,
        weeklyWorkHours: body.weekly_work_hours === undefined ? base.weeklyWorkHours : body.weekly_work_hours,
        isLocal: body.is_local ?? base.isLocal,
        visa: body.visa ?? base.visa,
        nationality: body.nationality ?? base.nationality,
      }
      return c.json(determineSocialInsurance(facts, body, today))
    })
    .get(`${PATH}/redetermine`, menu, (c) => {
      const { row, settings, result } = current(requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId')))
      const redetermined = { ...settings, ...result.recommended }
      const changed = (Object.keys(result.recommended) as (keyof typeof result.recommended)[]).filter((key) => settings[key] !== result.recommended[key])
      return c.json({ ...serialize(row, redetermined, result), changed_fields: changed, is_saved: changed.length === 0 })
    })
}

function factsOf(deps: ServiceDeps, employee: EmployeeRow, today: PlainDate): DeterminationFacts {
  return {
    birthDate: employee.birth_date,
    joinDate: employee.join_date,
    isLocal: employee.is_local === 1,
    visa: employee.visa,
    nationality: employee.nationality,
    weeklyWorkHours: findWorkContractAsOf(deps.db, employee.company_id, employee.id, today)?.weekly_work_hours ?? null,
  }
}

function serialize(row: SocialInsuranceRow | undefined, settings: SocialInsuranceSettings, result: DeterminationResult): Record<string, unknown> {
  return {
    ...settings,
    effective_from: row?.effective_from ?? null,
    determinations: result.determinations,
    messages: result.messages,
    recommended: result.recommended,
    updated: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  }
}
