import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { notFound } from '../../../lib/domain-error'
import { requireMenu } from '../../../middleware/access'
import { buildLaborCost, laborCostCsv } from './labor-cost'

/**
 * Labour cost report routes, mounted under `/api/company/:companyId`.
 *
 * - `GET /report/labor-cost/:year`: the report (bookkeeping spec N32).
 * - `GET /report/labor-cost/:year/export`: the same as CSV (N33 `labor-cost`).
 *
 * Both require the bookkeeping menu `settlement_reports_profit_loss_labor_cost`.
 * Payroll mounts before bookkeeping, so these replace its 404 placeholder.
 */
export function laborCostRoutes(deps: AppDeps): Hono<AppEnv> {
  const menu = requireMenu('settlement_reports_profit_loss_labor_cost')
  const report = (companyId: string, raw: string): ReturnType<typeof buildLaborCost> => buildLaborCost(deps.db, companyId, parseYear(raw), deps.clock.today())
  return new Hono<AppEnv>()
    .get('/report/labor-cost/:year/export', menu, (c) => {
      const body = report(c.var.company.id, c.req.param('year'))
      return c.body(laborCostCsv(body), 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`labor-cost-${body.year}.csv`)}`,
        'Cache-Control': 'private, no-store',
      })
    })
    .get('/report/labor-cost/:year', menu, (c) => c.json(report(c.var.company.id, c.req.param('year'))))
}

function parseYear(value: string): number {
  const year = Number(value)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw notFound('Report year')
  return year
}
