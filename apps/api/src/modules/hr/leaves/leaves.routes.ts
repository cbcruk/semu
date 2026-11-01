import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { requireMenu } from '../../../middleware/access'
import { requireIfMatch, versionTag } from '../../../middleware/if-match'
import { validationHook } from '../../../middleware/validation'
import { parseId, requireEmployee } from '../employees/employee-guard'
import type { HrContext } from '../shared/hr-context.types'
import { pageQuery } from '../shared/hr.schema'
import { fromFlag } from '../shared/hr.utils'
import { listLeaves } from './leaves.repository'
import { leaveBody } from './leaves.schema'
import { createLeave, removeLeave, replaceLeave, requireLeave, summarizeLeaves } from './leaves.service'
import type { LeaveRow } from './leaves.types'

const EMPLOYEE = '/employment/wage-employees/:employeeId{[0-9]+}'
const BASE = `${EMPLOYEE}/leave-of-absences`
const ONE = `${BASE}/:leaveId{[0-9]+}`

/**
 * Routes of an employee's leaves of absence (휴직).
 *
 * Creating, editing and deleting a leave changes the employee's status, so
 * those calls need `If-Match` with the employee version from `ETag`.
 */
export function leaveRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  return new Hono<AppEnv>()
    .get(`${EMPLOYEE}/leave-of-absence-info`, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const summary = summarizeLeaves(deps, employee, deps.clock.today())
      c.header('ETag', versionTag(employee.version))
      return c.json({
        ...summary,
        current_leave: summary.current_leave === null ? null : serializeLeave(summary.current_leave),
        upcoming_leave: summary.upcoming_leave === null ? null : serializeLeave(summary.upcoming_leave),
      })
    })
    .get(BASE, menu, zValidator('query', pageQuery, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = listLeaves(deps.db, c.var.company.id, employee.id, page.limit, page.offset)
      c.header('ETag', versionTag(employee.version))
      return c.json(toPage(rows.map(serializeLeave), count, page, c.req.url))
    })
    .get(ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      c.header('ETag', versionTag(employee.version))
      return c.json(serializeLeave(requireLeave(deps, employee, parseId(c.req.param('leaveId'), 'Leave of absence'))))
    })
    .post(BASE, menu, requireIfMatch(), zValidator('json', leaveBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const { leave, version } = createLeave(deps, employee, c.req.valid('json'), c.var.expectedVersion)
      c.header('ETag', versionTag(version))
      return c.json(serializeLeave(leave), 201)
    })
    .put(ONE, menu, requireIfMatch(), zValidator('json', leaveBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const { leave, version } = replaceLeave(deps, employee, parseId(c.req.param('leaveId'), 'Leave of absence'), c.req.valid('json'), c.var.expectedVersion)
      c.header('ETag', versionTag(version))
      return c.json(serializeLeave(leave))
    })
    .delete(ONE, menu, requireIfMatch(), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      removeLeave(deps, employee, parseId(c.req.param('leaveId'), 'Leave of absence'), c.var.expectedVersion)
      c.header('ETag', versionTag(c.var.expectedVersion + 1))
      return c.body(null, 204)
    })
}

/** Serialises a leave of absence. */
export function serializeLeave(leave: LeaveRow): Record<string, unknown> {
  return {
    id: leave.id,
    reason: leave.reason,
    start_date: leave.start_date,
    end_date: leave.end_date,
    expected_return_date: leave.expected_return_date,
    actual_return_date: leave.actual_return_date,
    is_paid: fromFlag(leave.is_paid),
    paid_allowance: leave.paid_allowance,
    include_in_service_years: fromFlag(leave.include_in_service_years),
    nps_payment_exception: fromFlag(leave.nps_payment_exception),
    nhis_notice_deferral: fromFlag(leave.nhis_notice_deferral),
    created: leave.created_at,
    updated: leave.updated_at,
  }
}
