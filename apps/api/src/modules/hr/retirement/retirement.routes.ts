import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import { requireMenu } from '../../../middleware/access'
import { requireIfMatch, versionTag } from '../../../middleware/if-match'
import { validationHook } from '../../../middleware/validation'
import { requireEmployee } from '../employees/employee-guard'
import type { HrContext } from '../shared/hr-context.types'
import { fromFlag } from '../shared/hr.utils'
import { readOptionalIfMatch } from '../shared/optional-if-match'
import { findRetirementInfo } from './retirement.repository'
import { retirementBody } from './retirement.schema'
import { cancelRetirement, saveRetirementInfo } from './retirement.service'
import type { RetirementInfoRow } from './retirement.types'

const PATH = '/employment/wage-employees/:employeeId{[0-9]+}/retirement-info'

/**
 * Routes of an employee's retirement benefit settings and retirement (퇴직).
 *
 * `PUT` with a changed `leave_date` and `DELETE` change the employee's
 * status and need `If-Match` with the employee version.
 */
export function retirementRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  return new Hono<AppEnv>()
    .get(PATH, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      c.header('ETag', versionTag(employee.version))
      return c.json(serializeRetirement(findRetirementInfo(deps.db, c.var.company.id, employee.id)))
    })
    .put(PATH, menu, zValidator('json', retirementBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const { info, version } = saveRetirementInfo(deps, employee, c.req.valid('json'), readOptionalIfMatch(c))
      c.header('ETag', versionTag(version))
      return c.json(serializeRetirement(info))
    })
    .delete(PATH, menu, requireIfMatch(), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      c.header('ETag', versionTag(cancelRetirement(deps, employee, c.var.expectedVersion)))
      return c.body(null, 204)
    })
}

/** Serialises retirement info, returning the defaults when nothing was saved yet. */
export function serializeRetirement(info: RetirementInfoRow | undefined): Record<string, unknown> {
  return {
    retirement_benefit_type: info?.retirement_benefit_type ?? 'grant',
    has_interim_settlement: info === undefined ? false : fromFlag(info.has_interim_settlement),
    interim_settlement_date: info?.interim_settlement_date ?? null,
    interim_settlement_reason: info?.interim_settlement_reason ?? null,
    leave_date: info?.leave_date ?? null,
    leaving_reason: info?.leaving_reason ?? null,
    leaving_detail_reason: info?.leaving_detail_reason ?? null,
    severance_amount: info?.severance_amount ?? null,
    severance_settlement_status: info?.severance_settlement_status ?? null,
    updated: info?.updated_at ?? null,
  }
}
