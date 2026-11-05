import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../../../app.types'
import { notFound } from '../../../lib/domain-error'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { resolveDateRange } from '../bookkeeping.utils'
import { businessStatusQuery, createPartnerBody, historyQuery, partnerListQuery, updatePartnerBody } from './partners.schema'
import {
  createPartner,
  deletePartner,
  getPartner,
  listAdjustmentHistory,
  listPartnerBankTransactions,
  listPartners,
  lookupBusinessStatus,
  updatePartner,
} from './partners.service'

const sideParam = z.object({ id: z.string(), side: z.enum(['sales', 'purchase']) })

/** Partner routes, mounted under `/api/company/:companyId`. */
export function partnerRoutes(deps: AppDeps): Hono<AppEnv> {
  const menu = requireMenu('bookkeeping_partners')
  return new Hono<AppEnv>()
    .get('/partner/scrap/business-status', menu, zValidator('query', businessStatusQuery, validationHook), async (c) =>
      c.json(await lookupBusinessStatus(deps, c.req.valid('query').business_number)),
    )
    .get('/partners', menu, zValidator('query', partnerListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = listPartners(deps, c.var.company.id, { search: query.search, kind: query.kind }, query.sort ?? '-created', page)
      return c.json(toPage(rows, count, page, c.req.url))
    })
    .post('/partners', menu, zValidator('json', createPartnerBody, validationHook), (c) =>
      c.json(createPartner(deps, c.var.company.id, c.req.valid('json')), 201),
    )
    .get('/partners/:id', menu, (c) => c.json(getPartner(deps, c.var.company.id, c.req.param('id'))))
    .patch('/partners/:id', menu, zValidator('json', updatePartnerBody, validationHook), (c) =>
      c.json(updatePartner(deps, c.var.company.id, c.req.param('id'), c.req.valid('json'))),
    )
    .delete('/partners/:id', menu, (c) => {
      deletePartner(deps, c.var.company.id, c.req.param('id'))
      return c.body(null, 204)
    })
    .get('/partners/:id/adjustment-history/:side', menu, zValidator('query', historyQuery, validationHook), (c) => {
      const params = sideParam.safeParse(c.req.param())
      if (!params.success) throw notFound('Route')
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const result = listAdjustmentHistory(deps.db, c.var.company.id, params.data.id, params.data.side, query.year, page)
      return c.json({ ...toPage(result.rows, result.count, page, c.req.url), totals: result.totals })
    })
    .get('/partners/:id/bank-transactions', menu, zValidator('query', historyQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const today = deps.clock.today()
      const range =
        query.start_date === undefined && query.end_date === undefined
          ? { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` }
          : resolveDateRange(query.start_date, query.end_date, today)
      const result = listPartnerBankTransactions(deps.db, c.var.company.id, c.req.param('id'), range, page)
      return c.json(toPage(result.rows, result.count, page, c.req.url))
    })
}
