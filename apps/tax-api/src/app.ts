import { Hono } from 'hono'
import type { AppDeps, AppEnv } from './app.types'
import { authenticate } from './middleware/auth'
import { companyScope } from './middleware/company-scope'
import { handleError, handleNotFound } from './middleware/error-handler'
import { homeRoutes } from './modules/action-cards/action-cards.routes'
import { estimatedVatRoutes } from './modules/estimated-vat/estimated-vat.routes'
import { deskFilingRoutes } from './modules/filings/filings.desk-routes'
import { filingRoutes } from './modules/filings/filings.routes'
import { menuTreeRoutes } from './modules/menu-tree/menu-tree.routes'

/**
 * Builds the tax API application.
 *
 * Customer routes live under `/api/company/:companyId` and agency routes
 * under `/api/desk`. Trailing slashes are optional so Django-style paths such
 * as `/tax/surtax/` keep working.
 *
 * @example Serving with Node
 * ```ts
 * import { serve } from '@hono/node-server'
 * import { createApp } from './app'
 *
 * serve({ fetch: createApp(deps).fetch, port: 8787 })
 * ```
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const company = new Hono<AppEnv>({ strict: false })
    .use('*', companyScope(deps))
    .route('/', menuTreeRoutes(deps))
    .route('/', filingRoutes(deps))
    .route('/', homeRoutes(deps))
    .route('/', estimatedVatRoutes(deps))

  const app = new Hono<AppEnv>({ strict: false })
  app.onError(handleError)
  app.notFound(handleNotFound)
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.use('/api/*', authenticate(deps))
  app.route('/api/company/:companyId', company)
  app.route('/api/desk', deskFilingRoutes(deps))
  return app
}
