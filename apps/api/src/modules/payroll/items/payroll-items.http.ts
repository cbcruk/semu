import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import type { PayrollItemRepository } from './payroll-item-repository.ts'
import {
  createDeductionItem,
  createPaymentItem,
  deleteDeductionItem,
  deletePaymentItem,
  getDeductionItem,
  getPaymentItem,
  listDeductionItems,
  listPaymentItemCategories,
  listPaymentItems,
  updateDeductionItem,
  updatePaymentItem,
} from './payroll-items.ts'

/** `payroll-payment-items` 그룹 핸들러입니다. */
export const PaymentItemsHttpLive = HttpApiBuilder.group(Api, 'payroll-payment-items', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<PayrollItemRepository>()
    return handlers
      .handle('categories', () => listPaymentItemCategories().pipe(Effect.provideContext(context)))
      .handle('list', ({ query }) =>
        listPaymentItems(query.includeArchived === 'true').pipe(Effect.provideContext(context)),
      )
      .handle('create', ({ payload }) =>
        createPaymentItem(payload).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('get', ({ params }) =>
        getPaymentItem(params.itemId).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('update', ({ params, payload, headers }) =>
        updatePaymentItem(params.itemId, payload, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('delete', ({ params }) => deletePaymentItem(params.itemId).pipe(Effect.provideContext(context)))
  }),
)

/** `payroll-deduction-items` 그룹 핸들러입니다. */
export const DeductionItemsHttpLive = HttpApiBuilder.group(Api, 'payroll-deduction-items', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<PayrollItemRepository>()
    return handlers
      .handle('list', ({ query }) =>
        listDeductionItems(query.includeArchived === 'true').pipe(Effect.provideContext(context)),
      )
      .handle('create', ({ payload }) =>
        createDeductionItem(payload).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('get', ({ params }) =>
        getDeductionItem(params.itemId).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('update', ({ params, payload, headers }) =>
        updateDeductionItem(params.itemId, payload, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('delete', ({ params }) => deleteDeductionItem(params.itemId).pipe(Effect.provideContext(context)))
  }),
)
