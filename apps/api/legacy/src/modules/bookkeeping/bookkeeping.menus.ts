import type { MenuRule, Plan } from '../access/access.types'
import { PROMOTION_URL } from '../access/promotion'

/**
 * Menu rules owned by the bookkeeping domain.
 *
 * - 경리 and 실시간 보고서 screens are free for every company.
 * - 세무 보고서 screens need the tax plan. Cash and financial position reports
 *   additionally need premium settlement, which is checked per company by
 *   {@linkcode requirePremiumSettlement} because it is not a plan.
 */
export const BOOKKEEPING_MENUS = {
  bookkeeping_sales_evidence: freeMenu('/evidence/sales/tax-invoice'),
  bookkeeping_purchase_evidence: freeMenu('/evidence/purchase/tax-invoice'),
  bookkeeping_bank_transactions: freeMenu('/bank/bank-transactions'),
  bookkeeping_bank_accounts: freeMenu('/bank/accounts'),
  bookkeeping_partners: freeMenu('/partners'),
  bookkeeping_sales_transactions: freeMenu('/transactions/manage/sales/list'),
  bookkeeping_tax_payment: freeMenu('/tax-payment/todo'),
  settings_accounting: freeMenu('/settings/accounting'),
  realtime_profit_loss: freeMenu('/reports/profit-loss/status'),
  realtime_cash: freeMenu('/reports/cash/daily-fund-report'),
  report_profit_loss: planMenu('/settlement-reports/profit-loss/statement', ['taxation']),
  settlement_reports_profit_loss_cost_details: planMenu('/settlement-reports/profit-loss/cost-details', ['taxation']),
  settlement_reports_profit_loss_labor_cost: planMenu('/settlement-reports/profit-loss/labor-cost', ['taxation']),
  report_cash: planMenu('/settlement-reports/cash/flow', ['taxation']),
  report_financial_position: planMenu('/settlement-reports/financial-position', ['taxation']),
} as const satisfies Record<string, MenuRule>

function freeMenu(path: string): MenuRule {
  return { path, requiredPlans: [], applicableTo: null, requiresPermission: true, requiresTaxTerms: false, promotionUrl: null }
}

function planMenu(path: string, requiredPlans: readonly Plan[]): MenuRule {
  return { path, requiredPlans, applicableTo: null, requiresPermission: true, requiresTaxTerms: false, promotionUrl: PROMOTION_URL }
}
