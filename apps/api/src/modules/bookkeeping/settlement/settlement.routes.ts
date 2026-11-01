import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { DomainError } from '../../../lib/domain-error'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { requirePremiumSettlement } from '../settings/bookkeeping-settings'
import { balanceSheetChart, balanceSheetSummary, balanceSheetTable } from './balance-sheet-report'
import { cashFlowSummary, cashFlowYear, partnerBalancesOfYear, partnerLedger, receivablePayableSummary, receivablePayableYear } from './cash-report'
import { buildCostDetails, buildProfitLoss } from './profit-loss-report'
import { type ExportKind, exportSettlementCsv } from './settlement-export'
import { pageQuery, partnerParam, yearParam } from './settlement.schema'
import { PARTNER_PAGE_SIZE, toNumberedPage } from './settlement.utils'

/** Tax report routes backed by settlement snapshots, mounted under `/api/company/:companyId`. */
export function settlementReportRoutes(deps: AppDeps): Hono<AppEnv> {
  const year = zValidator('param', yearParam, validationHook)
  const page = zValidator('query', pageQuery, validationHook)
  const partner = zValidator('param', partnerParam, validationHook)
  const premium = requirePremiumSettlement(deps)
  const profitLoss = requireMenu('report_profit_loss')
  const costDetails = requireMenu('settlement_reports_profit_loss_cost_details')
  const cash = requireMenu('report_cash')
  const position = requireMenu('report_financial_position')
  const csv = (c: Context<AppEnv>, kind: ExportKind, target: number): Response =>
    c.body(exportSettlementCsv(deps.db, c.var.company.id, kind, target), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${kind}-${target}.csv`)}`,
      'Cache-Control': 'private, no-store',
    })

  return new Hono<AppEnv>()
    .get('/report/profit-loss/:year/month-range', profitLoss, year, (c) =>
      c.json(buildProfitLoss(deps.db, c.var.company.id, c.req.valid('param').year, true)),
    )
    .get('/report/profit-loss/:year/cost-details', costDetails, year, (c) => c.json(buildCostDetails(deps.db, c.var.company.id, c.req.valid('param').year)))
    .get('/report/profit-loss/:year/export', profitLoss, year, (c) => csv(c, 'profit-loss', c.req.valid('param').year))
    .get('/report/profit-loss/:year', profitLoss, year, (c) => c.json(buildProfitLoss(deps.db, c.var.company.id, c.req.valid('param').year, false)))
    .get('/report/cost-details/:year/export', costDetails, year, (c) => csv(c, 'cost-details', c.req.valid('param').year))
    .get('/report/labor-cost/:year/export', () => {
      throw new DomainError('NOT_FOUND', 'The labor cost export is served by the payroll domain.')
    })
    .get('/report/cash-flow/summary', cash, premium, (c) => c.json(cashFlowSummary(deps.db, c.var.company.id)))
    .get('/report/cash-flow/:year/export', cash, premium, year, (c) => csv(c, 'cash-flow', c.req.valid('param').year))
    .get('/report/cash-flow/:year', cash, premium, year, (c) => c.json(cashFlowYear(deps.db, c.var.company.id, c.req.valid('param').year)))
    .get('/report/receivable-payable/:year/export', cash, premium, year, (c) => csv(c, 'receivable-payable', c.req.valid('param').year))
    .get('/report/balance-sheet/summary', position, premium, (c) => c.json(balanceSheetSummary(deps.db, c.var.company.id)))
    .get('/report/balance-sheet/chart/:year', position, premium, year, (c) => c.json(balanceSheetChart(deps.db, c.var.company.id, c.req.valid('param').year)))
    .get('/report/balance-sheet/table/:year', position, premium, year, (c) => c.json(balanceSheetTable(deps.db, c.var.company.id, c.req.valid('param').year)))
    .get('/report/balance-sheet/:year/export', position, premium, year, (c) => csv(c, 'balance-sheet', c.req.valid('param').year))
    .get('/accounting/settlement/receivable-payable/summary', cash, premium, (c) => c.json(receivablePayableSummary(deps.db, c.var.company.id)))
    .get('/accounting/settlement/receivable-payable/:year', cash, premium, year, (c) =>
      c.json(receivablePayableYear(deps.db, c.var.company.id, c.req.valid('param').year)),
    )
    .get('/accounting/settlement/receivable-by-partner/:year/:partnerId', cash, premium, partner, (c) =>
      c.json(partnerLedger(deps.db, c.var.company.id, 'receivable', c.req.valid('param').year, c.req.valid('param').partnerId)),
    )
    .get('/accounting/settlement/payable-by-partner/:year/:partnerId', cash, premium, partner, (c) =>
      c.json(partnerLedger(deps.db, c.var.company.id, 'payable', c.req.valid('param').year, c.req.valid('param').partnerId)),
    )
    .get('/accounting/settlement/receivable-by-partner/:year', cash, premium, year, page, (c) =>
      c.json(
        toNumberedPage(
          partnerBalancesOfYear(deps.db, c.var.company.id, 'receivable', c.req.valid('param').year),
          c.req.valid('query').page,
          PARTNER_PAGE_SIZE,
          c.req.url,
        ),
      ),
    )
    .get('/accounting/settlement/payable-by-partner/:year', cash, premium, year, page, (c) =>
      c.json(
        toNumberedPage(
          partnerBalancesOfYear(deps.db, c.var.company.id, 'payable', c.req.valid('param').year),
          c.req.valid('query').page,
          PARTNER_PAGE_SIZE,
          c.req.url,
        ),
      ),
    )
}
