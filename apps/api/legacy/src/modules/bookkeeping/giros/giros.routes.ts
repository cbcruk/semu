import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { requireMenu } from '../../../middleware/access'
import { toValidationError, validationHook } from '../../../middleware/validation'
import { countGirosByStatus, listGiros } from './giros.repository'
import { giroActionBody, listGirosQuery } from './giros.schema'
import { giroResponse, hideGiro, listPaymentAccounts, manualDoneGiro, requireGiro } from './giros.service'

/** Giro bill routes, mounted under `/api/company/:companyId`. */
export function giroRoutes(deps: AppDeps): Hono<AppEnv> {
  const guard = requireMenu('bookkeeping_tax_payment')
  const list = (companyId: string, url: string, raw: Record<string, string | undefined>): Record<string, unknown> => {
    const parsed = listGirosQuery.safeParse(raw)
    if (!parsed.success) throw toValidationError(parsed.error.issues)
    const page = parsePageRequest(parsed.data.limit, parsed.data.offset)
    const { rows, count } = listGiros(deps.db, companyId, parsed.data.status, parsed.data.search, page.limit, page.offset)
    return { ...toPage(rows.map((row) => giroResponse(deps.db, row)), count, page, url) }
  }

  return new Hono<AppEnv>()
    .get('/giros/summary', guard, (c) => c.json(countGirosByStatus(deps.db, c.var.company.id)))
    .get('/giros', guard, (c) => c.json(list(c.var.company.id, c.req.url, c.req.query())))
    .get('/giros/:id', guard, (c) => {
      const id = c.req.param('id')
      if (id.includes('=')) {
        const raw = Object.fromEntries(new URLSearchParams(id.replace(/^\?/, '')))
        return c.json(list(c.var.company.id, c.req.url, { ...raw, ...c.req.query() }))
      }
      return c.json(giroResponse(deps.db, requireGiro(deps.db, c.var.company.id, id)))
    })
    .get('/giros/:id/payment-accounts', guard, (c) => {
      requireGiro(deps.db, c.var.company.id, c.req.param('id'))
      return c.json(listPaymentAccounts(deps, c.var.company.id))
    })
    .post('/giros/:id/manual_done', guard, zValidator('json', giroActionBody, validationHook), (c) =>
      c.json(giroResponse(deps.db, manualDoneGiro(deps, c.var.company.id, c.req.param('id'), c.var.user.id, c.req.valid('json').memo))),
    )
    .post('/giros/:id/hide', guard, zValidator('json', giroActionBody, validationHook), (c) =>
      c.json(giroResponse(deps.db, hideGiro(deps, c.var.company.id, c.req.param('id'), c.var.user.id, c.req.valid('json').memo))),
    )
}
