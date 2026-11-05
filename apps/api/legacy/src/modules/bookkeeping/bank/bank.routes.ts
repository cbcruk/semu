import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { addDays } from '../../../lib/plain-date'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { csvResponse, resolveDateRange, toCsv } from '../bookkeeping.utils'
import {
  accountListQuery,
  accountPatchBody,
  balanceQuery,
  bulkClassifyBody,
  settlementBody,
  type TransactionListQuery,
  transactionListQuery,
  transactionPatchBody,
} from './bank.schema'
import {
  bulkClassifyBankTransactions,
  exportBankTransactions,
  linkSettlements,
  listBankAccounts,
  listBankTransactions,
  listDailyBalances,
  patchBankTransaction,
  unlinkSettlements,
  updateBankAccount,
} from './bank.service'
import type { BankTransactionFilter } from './bank.types'

/** Bank account and transaction routes, mounted under `/api/company/:companyId`. */
export function bankRoutes(deps: AppDeps): Hono<AppEnv> {
  const accounts = requireMenu('bookkeeping_bank_accounts')
  const transactions = requireMenu('bookkeeping_bank_transactions')
  const filterOf = (query: TransactionListQuery): BankTransactionFilter => {
    const range = resolveDateRange(query.start_date, query.end_date, deps.clock.today())
    return {
      ...range,
      direction: query.direction,
      accountIds: query.account_id ?? [],
      accountTitleIds: query.account_title_id ?? [],
      classification: query.classification_status,
      partnerId: query.partner_id,
      search: query.search,
    }
  }
  return new Hono<AppEnv>()
    .get('/bank/accounts', accounts, zValidator('query', accountListQuery, validationHook), (c) =>
      c.json(listBankAccounts(deps, c.var.company.id, c.req.valid('query').include_inactive === 'true')),
    )
    .patch('/bank/accounts/:id', accounts, zValidator('json', accountPatchBody, validationHook), (c) =>
      c.json(updateBankAccount(deps, c.var.company.id, c.req.param('id'), c.req.valid('json'))),
    )
    .get('/bank/accounts/:id/balances', accounts, zValidator('query', balanceQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const end = query.end_date ?? addDays(deps.clock.today(), -1)
      const start = query.start_date ?? addDays(end, -29)
      return c.json(listDailyBalances(deps.db, c.var.company.id, c.req.param('id'), start, end))
    })
    .get('/bank/transactions', transactions, zValidator('query', transactionListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const result = listBankTransactions(deps.db, c.var.company.id, filterOf(query), query.sort ?? '-transacted_at', page)
      return c.json({ ...toPage(result.rows, result.count, page, c.req.url), totals: result.totals, counts: result.counts })
    })
    .get('/bank/transactions/export', transactions, zValidator('query', transactionListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const filter = filterOf(query)
      const rows = exportBankTransactions(deps.db, c.var.company.id, filter, query.sort ?? '-transacted_at')
      const csv = toCsv([
        ['일시', '구분', '은행', '계좌', '금액', '잔액', '적요', '계정과목', '거래처', '메모', '증빙 연결'],
        ...rows.map((row) => [
          row.transacted_at,
          row.direction === 'deposit' ? '입금' : '출금',
          row.bank_code,
          row.account_number_tail,
          row.amount,
          row.balance_after,
          row.summary,
          row.account_title_name,
          row.partner_name,
          row.memo,
          row.settlement_status,
        ]),
      ])
      return csvResponse(c, `입출금내역_${filter.start}_${filter.end}.csv`, csv)
    })
    .post('/bank/transactions/bulk-classify', transactions, zValidator('json', bulkClassifyBody, validationHook), (c) =>
      c.json(bulkClassifyBankTransactions(deps, c.var.company.id, c.req.valid('json'))),
    )
    .patch('/bank/transactions/:id', transactions, zValidator('json', transactionPatchBody, validationHook), (c) =>
      c.json(patchBankTransaction(deps, c.var.company.id, c.req.param('id'), c.req.valid('json'))),
    )
    .post('/bank/transactions/:id/settlements', transactions, zValidator('json', settlementBody, validationHook), (c) =>
      c.json(linkSettlements(deps, c.var.company.id, c.req.param('id'), c.req.valid('json'))),
    )
    .delete('/bank/transactions/:id/settlements', transactions, (c) =>
      c.json(unlinkSettlements(deps, c.var.company.id, c.req.param('id'), c.req.query('evidence_id'))),
    )
}
