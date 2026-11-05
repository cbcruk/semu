import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { getPayslip, listPayslips, type PayslipDeps, sendPayslips } from './payslips.ts'

/** `payslips` 그룹 핸들러입니다. */
export const PayslipsHttpLive = HttpApiBuilder.group(Api, 'payslips', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<PayslipDeps>()
    return handlers
      .handle('list', ({ query }) => listPayslips(query).pipe(Effect.provideContext(context)))
      .handle('get', ({ params }) => getPayslip(params.payslipId).pipe(Effect.provideContext(context)))
      .handle('send', ({ payload, headers }) =>
        sendPayslips(payload.payslipIds, headers['idempotency-key']).pipe(Effect.provideContext(context)),
      )
  }),
)
