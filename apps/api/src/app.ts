import { Hono } from 'hono'
import type { AppDeps, AppEnv, DomainRoutes } from './app.types'
import { authenticate } from './middleware/auth'
import { companyScope } from './middleware/company-scope'
import { handleError, handleNotFound } from './middleware/error-handler'
import { homeRoutes } from './modules/action-cards/action-cards.routes'
import { bookkeepingRoutes } from './modules/bookkeeping/bookkeeping.routes'
import { estimatedVatRoutes } from './modules/estimated-vat/estimated-vat.routes'
import { deskFilingRoutes } from './modules/filings/filings.desk-routes'
import { filingRoutes } from './modules/filings/filings.routes'
import { hrRoutes } from './modules/hr/hr.routes'
import { menuTreeRoutes } from './modules/menu-tree/menu-tree.routes'
import { payrollRoutes } from './modules/payroll/payroll.routes'
import { platformRoutes } from './modules/platform/platform.routes'

/**
 * Builds the Alfred Business API application.
 *
 * Routes from every domain are mounted in three layers: public routes first,
 * then authenticated account routes, then company routes under
 * `/api/company/:companyId` behind the company scope check. Agency desk routes
 * live under `/api/desk`. Trailing slashes are optional so Django-style paths
 * such as `/tax/surtax/` keep working.
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
  const domains: DomainRoutes[] = [platformRoutes(deps), hrRoutes(deps), payrollRoutes(deps), bookkeepingRoutes(deps)]

  const company = new Hono<AppEnv>({ strict: false })
    .use('*', companyScope(deps))
    .route('/', menuTreeRoutes(deps))
    .route('/', filingRoutes(deps))
    .route('/', homeRoutes(deps))
    .route('/', estimatedVatRoutes(deps))
  for (const domain of domains) if (domain.company !== undefined) company.route('/', domain.company)

  const app = new Hono<AppEnv>({ strict: false })
  app.onError(handleError)
  app.notFound(handleNotFound)
  app.get('/health', (c) => c.json({ status: 'ok' }))
  for (const domain of domains) if (domain.public !== undefined) app.route('/', domain.public)
  app.use('/api/*', authenticate(deps))
  app.route('/api/company/:companyId', company)
  app.route('/api/desk', deskFilingRoutes(deps))
  for (const domain of domains) if (domain.account !== undefined) app.route('/', domain.account)
  return app
}
