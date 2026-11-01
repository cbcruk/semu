import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import { queryAll, queryOne } from '../../../db/query'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { maskTail } from '../../../lib/masking'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { requireEmployee } from '../employees/employee-guard'
import { findEmployeeView } from '../employees/employees.repository'
import { nonWageEmployeeBody } from '../employees/employees.schema'
import { serializeCommonInfo } from '../employees/employees.serializer'
import type { EmployeeView } from '../employees/employees.types'
import { STATUS_CODE, STATUS_LABEL } from '../employees/employees.utils'
import type { HrContext } from '../shared/hr-context.types'
import { pageQuery } from '../shared/hr.schema'
import { findNonWageDetail } from './non-wage.repository'
import { createNonWageEmployee, patchNonWageEmployee } from './non-wage.service'
import type { NonWageKind } from './non-wage.types'

const KIND_PATHS: readonly (readonly [NonWageKind, string])[] = [
  ['daily', '/employment/daily-employees'],
  ['business', '/employment/business-employees'],
  ['other', '/employment/other-employees'],
]

/**
 * Routes of daily workers, business income earners and other income earners.
 *
 * The bundle exposes only `PATCH`; list, detail and create are 신규 설계 so
 * the records can be managed without the payroll cards.
 */
export function nonWageEmployeeRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  const serialize = (view: EmployeeView): Record<string, unknown> => {
    const detail = findNonWageDetail(deps.db, view.company_id, view.id)
    return {
      ...serializeCommonInfo(view, deps.cipher),
      status: view.status,
      status_code: STATUS_CODE[view.status],
      status_display: STATUS_LABEL[view.status],
      department: view.department_id,
      department_name: view.department_name,
      position: view.position_id,
      position_name: view.position_name,
      join_date: view.join_date,
      leave_date: view.leave_date,
      daily_wage: detail?.daily_wage ?? null,
      business_code: detail?.business_code ?? null,
      other_income_code: detail?.other_income_code ?? null,
      bank_code: detail?.bank_code ?? null,
      account_number: detail?.account_number_enc == null ? null : maskTail(deps.cipher.decrypt(detail.account_number_enc), 4),
      account_holder: detail?.account_holder ?? null,
      created: view.created_at,
      updated: view.updated_at,
    }
  }
  const viewOf = (companyId: string, employeeId: number): EmployeeView => {
    const view = findEmployeeView(deps.db, companyId, employeeId, deps.clock.today())
    if (view === undefined) throw new Error('Employee view vanished after lookup.')
    return view
  }

  const router = new Hono<AppEnv>()
  for (const [kind, base] of KIND_PATHS) {
    const one = `${base}/:employeeId{[0-9]+}`
    router
      .get(base, menu, zValidator('query', pageQuery, validationHook), (c) => {
        const query = c.req.valid('query')
        const page = parsePageRequest(query.limit, query.offset)
        const ids = queryAll<{ id: number }>(deps.db, 'SELECT id FROM employees WHERE company_id = ? AND kind = ? ORDER BY name, id LIMIT ? OFFSET ?', [
          c.var.company.id,
          kind,
          page.limit,
          page.offset,
        ])
        const total = queryOne<{ n: number }>(deps.db, 'SELECT COUNT(*) AS n FROM employees WHERE company_id = ? AND kind = ?', [c.var.company.id, kind])
        const results = ids.map((row) => serialize(viewOf(c.var.company.id, row.id)))
        return c.json(toPage(results, total?.n ?? 0, page, c.req.url))
      })
      .post(base, menu, zValidator('json', nonWageEmployeeBody, validationHook), (c) => {
        const view = createNonWageEmployee(deps, c.var.company.id, kind, c.req.valid('json'), c.var.user.id)
        return c.json(serialize(view), 201)
      })
      .get(one, menu, (c) => {
        const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'), kind)
        return c.json(serialize(viewOf(employee.company_id, employee.id)))
      })
      .patch(one, menu, zValidator('json', nonWageEmployeeBody, validationHook), (c) => {
        const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'), kind)
        return c.json(serialize(patchNonWageEmployee(deps, employee, c.req.valid('json'))))
      })
  }
  return router
}
