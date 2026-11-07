import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { requirePermission } from '../common/wire.ts'
import { SalesTransactionService } from './sales-transaction-service.ts'

const SalesTransactionsGroupHttpLive = HttpApiBuilder.group(
  Api,
  'salesTransactions',
  Effect.fn(function* (handlers) {
    const sales = yield* SalesTransactionService

    return handlers.handleAll({
      list: ({ query: { limit, cursor, ...filter } }) =>
        Effect.flatMap(requirePermission('sales-transaction:read'), (actor) =>
          sales.list(actor.companyId, filter, {
            ...(limit === undefined ? {} : { limit }),
            ...(cursor === undefined ? {} : { cursor }),
          }),
        ),
      create: ({ payload }) =>
        Effect.flatMap(requirePermission('sales-transaction:create'), (actor) =>
          sales.create(actor.companyId, payload),
        ),
      get: ({ params }) =>
        Effect.flatMap(requirePermission('sales-transaction:read'), (actor) =>
          sales.get(actor.companyId, params.salesTransactionId).pipe(Effect.map(withEtag)),
        ),
      update: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('sales-transaction:update'), (actor) =>
          sales
            .update(actor.companyId, params.salesTransactionId, payload, expectedVersion(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
      remove: ({ params }) =>
        Effect.flatMap(requirePermission('sales-transaction:delete'), (actor) =>
          sales.remove(actor.companyId, params.salesTransactionId),
        ),
    })
  }),
)

const TaxInvoicesHttpLive = HttpApiBuilder.group(
  Api,
  'taxInvoices',
  Effect.fn(function* (handlers) {
    const sales = yield* SalesTransactionService

    return handlers.handleAll({
      issue: ({ headers, payload }) =>
        Effect.gen(function* () {
          const actor = yield* requirePermission('tax-invoice:issue')
          return yield* sales.issue(
            actor.companyId,
            actor.userId,
            payload.salesTransactionId,
            headers['idempotency-key'],
          )
        }),
      list: ({ query }) =>
        Effect.flatMap(requirePermission('tax-invoice:read'), (actor) =>
          Effect.map(sales.listInvoices(actor.companyId, query.salesTransactionId), (items) => ({ items })),
        ),
      get: ({ params }) =>
        Effect.flatMap(requirePermission('tax-invoice:read'), (actor) =>
          sales.getInvoice(actor.companyId, params.taxInvoiceId),
        ),
      sync: ({ params }) =>
        Effect.flatMap(requirePermission('tax-invoice:read'), (actor) =>
          sales.syncInvoice(actor.companyId, params.taxInvoiceId),
        ),
    })
  }),
)

/** 거래명세서·세금계산서 핸들러입니다. */
export const SalesTransactionsHttpLive = Layer.mergeAll(SalesTransactionsGroupHttpLive, TaxInvoicesHttpLive)
