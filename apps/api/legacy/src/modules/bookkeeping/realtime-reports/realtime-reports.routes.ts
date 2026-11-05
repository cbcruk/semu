import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { addDays } from '../../../lib/plain-date'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { cashDailyQuery, cashPeriodQuery, profitLossQuery, salesPurchaseQuery } from './realtime-reports.schema'
import { cashDaily, cashPeriod, homeSummaryCards, realtimeProfitLoss, salesPurchaseStatus } from './realtime-reports.service'
import { SALES_PURCHASE_PRESETS } from './realtime-reports.utils'

/**
 * Realtime report and home card routes, mounted under `/api/company/:companyId`.
 *
 * `/home/summary-cards` sits behind the existing `/home/*` guard of the 오늘의 할 일 menu.
 */
export function realtimeReportRoutes(deps: AppDeps): Hono<AppEnv> {
  const profitLoss = requireMenu('realtime_profit_loss')
  const cash = requireMenu('realtime_cash')
  return new Hono<AppEnv>()
    .get('/reports/profit-loss/status', profitLoss, zValidator('query', profitLossQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const year = query.year ?? Number(deps.clock.today().slice(0, 4))
      return c.json(realtimeProfitLoss(deps, c.var.company.id, year, query.cumulative === 'true'))
    })
    .get('/reports/profit-loss/sales-purchase', profitLoss, zValidator('query', salesPurchaseQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const preset = query.preset ?? (query.start !== undefined && query.unit === 'day' ? 'custom' : SALES_PURCHASE_PRESETS[query.unit][0] ?? '')
      return c.json(salesPurchaseStatus(deps, c.var.company.id, query.unit, preset, { start: query.start, end: query.end }))
    })
    .get('/reports/cash/daily', cash, zValidator('query', cashDailyQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      return c.json(cashDaily(deps, c.var.company.id, query.date ?? addDays(deps.clock.today(), -1), query.group_by))
    })
    .get('/reports/cash/period', cash, zValidator('query', cashPeriodQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      return c.json(cashPeriod(deps, c.var.company.id, query.unit, query.preset))
    })
    .get('/home/summary-cards', (c) => c.json(homeSummaryCards(deps, c.var.company)))
}
