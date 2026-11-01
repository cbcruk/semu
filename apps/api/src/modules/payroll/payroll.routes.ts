import { Hono } from 'hono'
import type { AppDeps, AppEnv, DomainRoutes } from '../../app.types'
import { ensureRateTables } from './reference/rate-tables.repository'
import { referenceRoutes } from './reference/reference.routes'
import { settingsRoutes } from './settings/settings.routes'
import { NO_USAGE } from './settings/settings.service'
import type { SettingsUsageCounter } from './settings/settings.types'

/** Options of {@linkcode payrollRoutes}. */
export interface PayrollRouteOptions {
  /** Counts where work conditions and schedule policies are used; defaults to {@linkcode NO_USAGE}. */
  usage?: SettingsUsageCounter
}

/**
 * Builds the payroll domain's routers.
 *
 * - `account`: `/api/payroll/*` reference data and calculator, `/api/tax-rates/*`.
 * - `company`: `/employment/settings/*` payroll settings.
 *
 * Seeds the built-in rate tables on start, keeping rows that already exist.
 */
export function payrollRoutes(deps: AppDeps, options: PayrollRouteOptions = {}): DomainRoutes {
  ensureRateTables(deps.db, deps.clock.now())
  return {
    account: referenceRoutes(deps),
    company: new Hono<AppEnv>().route('/employment/settings', settingsRoutes(deps, options.usage ?? NO_USAGE)),
  }
}
