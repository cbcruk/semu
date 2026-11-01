import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { requireMenu } from '../../../middleware/access'
import { toValidationError, validationHook } from '../../../middleware/validation'
import { readOptionalJson } from '../bookkeeping.utils'
import { createBody, deleteBody, treeQuery, updateBody } from './account-titles.schema'
import { createAccountTitle, deleteAccountTitle, getAccountTitleTree, updateAccountTitle } from './account-titles.service'

/**
 * Account title tree routes, mounted under `/api/company/:companyId`.
 *
 * Reading the tree needs only company membership because every 경리 screen's
 * dropdown uses it; changes need the 계정과목 관리 settings menu.
 */
export function accountTitleRoutes(deps: AppDeps): Hono<AppEnv> {
  const manage = requireMenu('settings_accounting')
  return new Hono<AppEnv>()
    .get('/account-titles', zValidator('query', treeQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      return c.json({ results: getAccountTitleTree(deps.db, c.var.company.id, query.applies_to, query.search) })
    })
    .post('/account-titles', manage, zValidator('json', createBody, validationHook), (c) =>
      c.json(createAccountTitle(deps, c.var.company.id, c.req.valid('json')), 201),
    )
    .patch('/account-titles/:id', manage, zValidator('json', updateBody, validationHook), (c) =>
      c.json(updateAccountTitle(deps, c.var.company.id, c.req.param('id'), c.req.valid('json'))),
    )
    .delete('/account-titles/:id', manage, async (c) => {
      const parsed = deleteBody.safeParse(await readOptionalJson(c.req.raw, { move_to_id: c.req.query('move_to_id') }))
      if (!parsed.success) throw toValidationError(parsed.error.issues)
      return c.json(deleteAccountTitle(deps, c.var.company.id, c.req.param('id'), parsed.data.move_to_id))
    })
}
