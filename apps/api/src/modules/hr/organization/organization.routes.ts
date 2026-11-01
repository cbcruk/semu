import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../../app.types'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { requireAnyMenu } from '../shared/hr-access'
import type { HrContext } from '../shared/hr-context.types'
import { isOrganizationUnitUsed, listOrganizationUnits, replaceOrganizationUnits } from './organization.repository'
import type { OrganizationTable, OrganizationUnitRow } from './organization.types'

const unit = z.object({ id: z.number().int().positive().optional(), name: z.string().trim().min(1).max(100) })
const bulkBody = z.union([z.array(unit), z.object({ items: z.array(unit) })]).transform((body) => (Array.isArray(body) ? body : body.items))

/** Routes of the department and position lookups and their bulk editors (부서/직위 설정). */
export function organizationRoutes({ deps }: HrContext): Hono<AppEnv> {
  const read = requireAnyMenu(['employment_employee', 'employment_e_sign', 'employment_certificate', 'settings_e_sign'])
  const write = requireMenu('employment_employee')
  const serializeAll = (table: OrganizationTable, rows: OrganizationUnitRow[]): Record<string, unknown> => {
    const results = rows.map((row) => ({ id: row.id, name: row.name, order: row.sort_order, is_used: isOrganizationUnitUsed(deps.db, table, row) }))
    return { count: results.length, next: null, previous: null, results }
  }

  const router = new Hono<AppEnv>()
  for (const table of ['departments', 'positions'] as const) {
    router
      .get(`/employment/${table}`, read, (c) => c.json(serializeAll(table, listOrganizationUnits(deps.db, table, c.var.company.id))))
      .post(`/employment/${table}/bulk`, write, zValidator('json', bulkBody, validationHook), (c) => {
        const rows = replaceOrganizationUnits(deps.db, table, c.var.company.id, c.req.valid('json'), deps.clock.now())
        return c.json(serializeAll(table, rows))
      })
  }
  return router
}
