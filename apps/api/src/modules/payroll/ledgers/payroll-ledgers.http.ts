import { Effect } from 'effect'
import { HttpApiBuilder, HttpApiSchema } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import {
  addRow,
  createLedger,
  deleteLedger,
  deleteRow,
  getLedger,
  type LedgerDeps,
  listLedgers,
  listRows,
  recalculateLedger,
  transitionLedger,
  updateLedger,
  updateRow,
} from './payroll-ledgers.ts'

function rowWithEtag<A>(result: { ledger: { version: number }; row: A }) {
  return HttpApiSchema.withHeaders({ body: result.row, headers: { etag: `"${result.ledger.version}"` } })
}

/** `payroll-ledgers` 그룹 핸들러입니다. */
export const PayrollLedgersHttpLive = HttpApiBuilder.group(Api, 'payroll-ledgers', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<LedgerDeps>()
    const version = (headers: { readonly 'if-match'?: string }) => expectedVersion(headers['if-match'])
    return handlers
      .handle('list', ({ query }) => listLedgers(query).pipe(Effect.provideContext(context)))
      .handle('create', ({ payload }) =>
        createLedger(payload).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('get', ({ params }) =>
        getLedger(params.ledgerId).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('update', ({ params, payload, headers }) =>
        updateLedger(params.ledgerId, payload, version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('delete', ({ params, headers }) =>
        deleteLedger(params.ledgerId, version(headers)).pipe(Effect.provideContext(context)),
      )
      .handle('listRows', ({ params }) => listRows(params.ledgerId).pipe(Effect.provideContext(context)))
      .handle('addRow', ({ params, payload, headers }) =>
        addRow(params.ledgerId, payload, version(headers)).pipe(
          Effect.map(rowWithEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('updateRow', ({ params, payload, headers }) =>
        updateRow(params.ledgerId, params.rowId, payload, version(headers)).pipe(
          Effect.map(rowWithEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('deleteRow', ({ params, headers }) =>
        deleteRow(params.ledgerId, params.rowId, version(headers)).pipe(Effect.provideContext(context)),
      )
      .handle('recalculate', ({ params, headers }) =>
        recalculateLedger(params.ledgerId, version(headers)).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('submit', ({ params, headers }) =>
        transitionLedger(params.ledgerId, 'SUBMIT', undefined, version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('returnToDraft', ({ params, headers }) =>
        transitionLedger(params.ledgerId, 'RETURN_TO_DRAFT', undefined, version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('requestApproval', ({ params, headers }) =>
        transitionLedger(params.ledgerId, 'REQUEST_APPROVAL', undefined, version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('withdrawApprovalRequest', ({ params, headers }) =>
        transitionLedger(params.ledgerId, 'WITHDRAW_APPROVAL_REQUEST', undefined, version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('close', ({ params, headers }) =>
        transitionLedger(params.ledgerId, 'CLOSE', undefined, version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('reopen', ({ params, payload, headers }) =>
        transitionLedger(params.ledgerId, 'REOPEN', payload.reason, version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
  }),
)

/** `payroll-ledger-approvals` 그룹 핸들러입니다. */
export const PayrollLedgerApprovalsHttpLive = HttpApiBuilder.group(Api, 'payroll-ledger-approvals', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<LedgerDeps>()
    return handlers
      .handle('approve', ({ params, headers }) =>
        transitionLedger(params.ledgerId, 'APPROVE', undefined, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('reject', ({ params, payload, headers }) =>
        transitionLedger(params.ledgerId, 'REJECT', payload.reason, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
  }),
)
