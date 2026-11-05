import { Hono } from 'hono'
import type { AppDeps, AppEnv, DomainRoutes } from '../../app.types'
import { DomainError, notFound } from '../../lib/domain-error'
import { bpoRoutes } from './cards/bpo.routes'
import { legacyRoutes, maintainPayrollRoutes } from './cards/legacy.routes'
import { isYearMonth } from './engine/rate-table'
import { ensureRateTables } from './reference/rate-tables.repository'
import { referenceRoutes } from './reference/reference.routes'
import { laborCostRoutes } from './reports/labor-cost.routes'
import { createHrUsageCounter } from './settings/hr-usage-counter'
import { settingsRoutes } from './settings/settings.routes'
import type { SettingsUsageCounter } from './settings/settings.types'
import { severanceRoutes } from './severance/severance.routes'
import { withholdingSummary } from './withholding/withholding-summary'

/** Options of {@linkcode payrollRoutes}. */
export interface PayrollRouteOptions {
  /** Counts where work conditions and schedule policies are used; defaults to counting HR work contracts. */
  usage?: SettingsUsageCounter
}

/**
 * Builds the payroll domain's routers.
 *
 * - `public`: `/api/company/new-payroll/maintain-payroll/:companyId` (authenticated inline).
 * - `account`: `/api/payroll/*` reference data and calculator, `/api/tax-rates/*`.
 * - `company`: `/employment/settings/*` payroll settings, `/payroll/bpo/**` cards and
 *   severance settlements, legacy `/payroll/cards*` and `/payroll/card-summary*`,
 *   `/payroll/withholding-summary/:paymentMonth` and `/report/labor-cost/:year`.
 *
 * Seeds the built-in rate tables on start, keeping rows that already exist.
 */
export function payrollRoutes(deps: AppDeps, options: PayrollRouteOptions = {}): DomainRoutes {
  ensureRateTables(deps.db, deps.clock.now())
  const company = new Hono<AppEnv>()
    .route('/employment/settings', settingsRoutes(deps, options.usage ?? createHrUsageCounter(deps.db, deps.clock)))
    .route('/payroll/bpo/severance/settlements', severanceRoutes(deps))
    .route('/payroll/bpo', bpoRoutes(deps))
    .route('/payroll', legacyRoutes(deps))
    .get('/payroll/withholding-summary/:paymentMonth', (c) => {
      if (c.var.access.actor !== 'agency') throw new DomainError('PERMISSION_DENIED', 'Only agency staff can read the withholding summary.')
      const month = c.req.param('paymentMonth')
      if (!isYearMonth(month)) throw notFound('Payment month')
      return c.json(withholdingSummary(deps.db, c.var.company.id, month))
    })
    .route('/', laborCostRoutes(deps))
  return { public: maintainPayrollRoutes(deps), account: referenceRoutes(deps), company }
}
