import type { AppDeps } from '../app.types'
import { resolveHrAdapters } from '../modules/hr/adapters/hr-adapters'
import { expireOverdueESignRequests } from '../modules/hr/e-sign/e-sign-requests.service'
import { refreshSubscriptions, runBillingCycle } from '../modules/platform/billing/billing.service'
import { processScrapQueue } from '../modules/platform/integrations/scrap.service'
import { resolvePlatformDeps } from '../modules/platform/platform-deps'
import { scheduleFilings } from './schedule-filings'
import { sweepOrphanFiles } from './sweep-orphan-files'

/** What one run of {@linkcode runPeriodicJobs} did, per job. */
export interface PeriodicJobsReport {
  filings: ReturnType<typeof scheduleFilings>
  scraping: { done: number; timedOut: number }
  expiredESignRequests: number
  refreshedSubscriptions: number
  billedPayments: number
  sweptFiles: number
}

/**
 * Runs every recurring job once, in dependency order.
 *
 * Subscriptions refresh before filings are scheduled, because the plan decides
 * which filings a company gets. Each job is idempotent, so an external cron can
 * call this every few minutes.
 */
export async function runPeriodicJobs(deps: AppDeps): Promise<PeriodicJobsReport> {
  const platform = resolvePlatformDeps(deps)
  const refreshedSubscriptions = refreshSubscriptions(deps)
  const billed = await runBillingCycle(platform)
  const filings = scheduleFilings(deps.db, deps.clock)
  const scraping = await processScrapQueue(platform)
  const expiredESignRequests = await expireOverdueESignRequests({ deps, adapters: resolveHrAdapters(deps) })
  const swept = await sweepOrphanFiles(deps.db, deps.storage, new Date(deps.clock.now()))
  return { filings, scraping, expiredESignRequests, refreshedSubscriptions, billedPayments: billed.length, sweptFiles: swept.length }
}
