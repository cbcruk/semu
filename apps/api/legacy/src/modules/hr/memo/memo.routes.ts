import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../../app.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { requireEmployee } from '../employees/employee-guard'
import type { HrContext } from '../shared/hr-context.types'
import { pageQuery } from '../shared/hr.schema'
import { clearMemo, findMemo, listMemoHistories, saveMemo } from './memo.repository'

const ONE = '/employment/wage-employees/:employeeId{[0-9]+}'
const memoBody = z.object({ content: z.string().max(5000) })

/** Routes of an employee's 특이사항 memo and its change history. */
export function memoRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  const read = (companyId: string, employeeId: number): Record<string, unknown> => {
    const row = findMemo(deps.db, companyId, employeeId)
    return { content: row?.content ?? '', updated: row?.updated_at ?? null, updated_by: row?.updated_by ?? null }
  }

  return new Hono<AppEnv>()
    .get(`${ONE}/memo`, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(read(c.var.company.id, employee.id))
    })
    .put(`${ONE}/memo`, menu, zValidator('json', memoBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      saveMemo(deps.db, c.var.company.id, employee.id, c.req.valid('json').content, c.var.user.id, deps.clock.now())
      return c.json(read(c.var.company.id, employee.id))
    })
    .delete(`${ONE}/memo`, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      clearMemo(deps.db, c.var.company.id, employee.id, c.var.user.id, deps.clock.now())
      return c.body(null, 204)
    })
    .get(`${ONE}/memo-histories`, menu, zValidator('query', pageQuery, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = listMemoHistories(deps.db, c.var.company.id, employee.id, page.limit, page.offset)
      const results = rows.map((row) => ({ id: row.id, action: row.action, content: row.content, created: row.created_at, created_by: row.created_by }))
      return c.json(toPage(results, count, page, c.req.url))
    })
}
