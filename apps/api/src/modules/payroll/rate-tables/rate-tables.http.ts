import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import type { PayrollItemRepository } from '../items/payroll-item-repository.ts'
import type { RateTableRepository } from './rate-table-repository.ts'
import { getRateTable, listRateTables, listReferenceCodes, simulate } from './rate-tables.ts'

/** `rate-tables` 그룹 핸들러입니다. */
export const RateTablesHttpLive = HttpApiBuilder.group(Api, 'rate-tables', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<RateTableRepository>()
    return handlers
      .handle('list', ({ query }) => listRateTables(query.month).pipe(Effect.provideContext(context)))
      .handle('get', ({ params }) => getRateTable(params.rateTableId).pipe(Effect.provideContext(context)))
      .handle('referenceCodes', ({ query }) => listReferenceCodes(query.month))
  }),
)

/** `payroll-calculator` 그룹 핸들러입니다. */
export const PayrollCalculatorHttpLive = HttpApiBuilder.group(Api, 'payroll-calculator', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<RateTableRepository | PayrollItemRepository>()
    return handlers.handle('simulate', ({ payload }) => simulate(payload).pipe(Effect.provideContext(context)))
  }),
)
