import { Hono } from 'hono'
import type { AppDeps, AppEnv, DomainRoutes } from '../../app.types'
import { accountTitleRoutes } from './account-titles/account-titles.routes'
import { bankRoutes } from './bank/bank.routes'
import { classificationRuleRoutes } from './classification/classification.routes'
import { evidenceRoutes } from './evidence/evidence.routes'
import { giroRoutes } from './giros/giros.routes'
import { giroV2Routes } from './giros/giros.v2-routes'
import { miscAccountRoutes } from './misc/misc.account-routes'
import { miscPublicRoutes } from './misc/misc.public-routes'
import { miscRoutes } from './misc/misc.routes'
import { partnerRoutes } from './partners/partners.routes'
import { realtimeReportRoutes } from './realtime-reports/realtime-reports.routes'
import { settlementDeskRoutes } from './settlement/settlement.desk-routes'
import { settlementReportRoutes } from './settlement/settlement.routes'
import { transactionSalesRoutes } from './transaction-sales/transaction-sales.routes'

/**
 * Builds the bookkeeping domain's routers.
 *
 * - `company`: 경리 screens, realtime reports and settlement-backed tax reports.
 * - `account`: the v2 giro payment path, the agency settlement upload under
 *   `/api/desk/companies/:companyId` and the company-less year-end schedule.
 * - `public`: the signed attachment upload target.
 */
export function bookkeepingRoutes(deps: AppDeps): DomainRoutes {
  const company = new Hono<AppEnv>()
    .route('/', accountTitleRoutes(deps))
    .route('/', classificationRuleRoutes(deps))
    .route('/', evidenceRoutes(deps))
    .route('/', bankRoutes(deps))
    .route('/', partnerRoutes(deps))
    .route('/', realtimeReportRoutes(deps))
    .route('/', transactionSalesRoutes(deps))
    .route('/', giroRoutes(deps))
    .route('/', miscRoutes(deps))
    .route('/', settlementReportRoutes(deps))
  const account = new Hono<AppEnv>()
    .route('/', giroV2Routes(deps))
    .route('/', settlementDeskRoutes(deps))
    .route('/', miscAccountRoutes(deps))
  return { company, account, public: miscPublicRoutes(deps) }
}
