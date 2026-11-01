import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { listInvoices, listTransactions, summarizeTransactions } from './transaction-sales.repository'
import { createTransactionBody, listTransactionsQuery, patchTransactionBody } from './transaction-sales.schema'
import {
  createTransaction,
  patchTransaction,
  publishInvoice,
  removeTransaction,
  requireTransaction,
  serializeTransaction,
  syncInvoice,
} from './transaction-sales.service'
import type { SalesTransactionFilters } from './transaction-sales.types'
import { toIssuedInvoice } from './transaction-sales.utils'

/** Transaction statement and tax invoice routes, mounted under `/api/company/:companyId`. */
export function transactionSalesRoutes(deps: AppDeps): Hono<AppEnv> {
  const guard = requireMenu('bookkeeping_sales_transactions')
  const query = zValidator('query', listTransactionsQuery, validationHook)
  const filtersOf = (value: { search?: string | undefined; start_date?: string | undefined; end_date?: string | undefined }): SalesTransactionFilters => ({
    search: value.search,
    startDate: value.start_date,
    endDate: value.end_date,
  })

  return new Hono<AppEnv>()
    .get('/transaction-sales/summary', guard, query, (c) => {
      const summary = summarizeTransactions(deps.db, c.var.company.id, filtersOf(c.req.valid('query')))
      return c.json({
        total_transaction_count: summary.transaction_count,
        total_transaction_amount: summary.transaction_amount,
        total_invoice_count: summary.issued_count,
        total_invoice_amount: summary.issued_amount,
        issue_required_amount: summary.transaction_amount - summary.issued_amount,
      })
    })
    .get('/transaction-sales/summary/issued-status', guard, query, (c) => {
      const summary = summarizeTransactions(deps.db, c.var.company.id, filtersOf(c.req.valid('query')))
      return c.json({ all: summary.transaction_count, issue_required: summary.transaction_count - summary.issued_count, issued: summary.issued_count })
    })
    .get('/transaction-sales', guard, query, (c) => {
      const value = c.req.valid('query')
      const page = parsePageRequest(value.limit, value.offset)
      const filters: SalesTransactionFilters = {
        ...filtersOf(value),
        isIssued: value.is_issued_invoice,
        issueInvoiceType: value.issue_invoice_type,
        invoiceType: value.invoice_type,
      }
      const { rows, count } = listTransactions(deps.db, c.var.company.id, filters, value.sort, page.limit, page.offset)
      return c.json(toPage(rows.map((row) => serializeTransaction(deps, row)), count, page, c.req.url))
    })
    .post('/transaction-sales', guard, zValidator('json', createTransactionBody, validationHook), (c) =>
      c.json(serializeTransaction(deps, createTransaction(deps, c.var.company, c.req.valid('json')), true), 201),
    )
    .get('/transaction-sales/:id', guard, (c) => c.json(serializeTransaction(deps, requireTransaction(deps, c.var.company.id, c.req.param('id')), true)))
    .patch('/transaction-sales/:id', guard, zValidator('json', patchTransactionBody, validationHook), (c) =>
      c.json(serializeTransaction(deps, patchTransaction(deps, c.var.company, c.req.param('id'), c.req.valid('json')), true)),
    )
    .delete('/transaction-sales/:id', guard, (c) => {
      removeTransaction(deps, c.var.company.id, c.req.param('id'))
      return c.body(null, 204)
    })
    .post('/transaction-sales/:id/invoices/publish', guard, async (c) => c.json(await publishInvoice(deps, c.var.company.id, c.req.param('id')), 201))
    .post('/transaction-sales/:id/invoices/:invoiceId/sync', guard, async (c) =>
      c.json(await syncInvoice(deps, c.var.company.id, c.req.param('id'), c.req.param('invoiceId'))),
    )
    .get('/transaction-sales/:id/invoices', guard, (c) => {
      requireTransaction(deps, c.var.company.id, c.req.param('id'))
      const results = listInvoices(deps.db, c.req.param('id')).map(toIssuedInvoice)
      return c.json({ count: results.length, next: null, previous: null, results })
    })
}
