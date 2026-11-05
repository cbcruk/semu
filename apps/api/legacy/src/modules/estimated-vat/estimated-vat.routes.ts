import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps, AppEnv } from '../../app.types'
import { isPlainDate, toPlainDate } from '../../lib/plain-date'
import { requireMenu } from '../../middleware/access'
import { validationHook } from '../../middleware/validation'
import { estimateVat, vatTrend } from './estimated-vat.service'

const estimateQuery = z.object({
  on: z.string().refine(isPlainDate, 'Expected a YYYY-MM-DD date.').transform(toPlainDate).optional(),
})
const trendQuery = z.object({ years: z.coerce.number().int().min(1).max(5).default(2) })

/** Estimated VAT routes under the realtime reports menu. */
export function estimatedVatRoutes(deps: AppDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .use('/reports/estimated-vat/*', requireMenu('estimated_vat'))
    .use('/reports/estimated-vat', requireMenu('estimated_vat'))
    .get('/reports/estimated-vat', zValidator('query', estimateQuery, validationHook), (c) =>
      c.json(estimateVat(deps.db, c.var.company, c.req.valid('query').on ?? deps.clock.today())),
    )
    .get('/reports/estimated-vat/trend', zValidator('query', trendQuery, validationHook), (c) =>
      c.json({ results: vatTrend(deps.db, c.var.company, c.req.valid('query').years, deps.clock.today()) }),
    )
}
