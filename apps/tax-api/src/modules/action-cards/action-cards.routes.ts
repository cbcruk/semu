import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../../app.types'
import { parsePageRequest, toPage } from '../../lib/drf-pagination'
import { requireMenu } from '../../middleware/access'
import { validationHook } from '../../middleware/validation'
import { listTracker } from '../tracker/tracker.service'
import { completeActionCard, listActionCards, summarizeActionCards } from './action-cards.service'

const pageQuery = z.object({ limit: z.string().optional(), offset: z.string().optional() })
const completeBody = z.object({ completion_reason: z.enum(['done', 'skip']) })

/** Home routes compatible with the legacy `/home/action-cards` and `/home/tracker` endpoints. */
export function homeRoutes(deps: AppDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .use('/home/*', requireMenu('today'))
    .get('/home/action-cards/summary', (c) => c.json(summarizeActionCards(deps, c.var.company.id, c.var.access)))
    .get('/home/action-cards/active', zValidator('query', pageQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = listActionCards(deps, c.var.company.id, c.var.access, 'active', page)
      return c.json(toPage(rows, count, page, c.req.url))
    })
    .get('/home/action-cards/archived', zValidator('query', pageQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = listActionCards(deps, c.var.company.id, c.var.access, 'archived', page)
      return c.json(toPage(rows, count, page, c.req.url))
    })
    .post('/home/action-cards/:cardId/complete', zValidator('json', completeBody, validationHook), (c) =>
      c.json(completeActionCard(deps, c.var.company.id, c.var.access, c.req.param('cardId'), c.req.valid('json').completion_reason)),
    )
    .get('/home/tracker', (c) => c.json({ results: listTracker(deps, c.var.company.id, c.var.access) }))
}
