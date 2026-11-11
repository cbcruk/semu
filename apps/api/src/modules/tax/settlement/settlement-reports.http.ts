import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import type { TaxSettingRepository } from '../settings/tax-setting-repository.ts'
import type { SettlementSnapshotRepository } from './settlement-snapshot-repository.ts'
import {
  getBalanceSheetReport,
  getCashFlowReport,
  getPartnerLedger,
  getProfitLossReport,
  getReceivablePayableReport,
  listSettlementReports,
  uploadBalanceSheet,
  uploadCashFlow,
  uploadProfitLoss,
  uploadReceivablePayable,
} from './settlement-reports.ts'

/** `settlement-reports` 그룹 핸들러입니다. */
export const SettlementReportsHttpLive = HttpApiBuilder.group(Api, 'settlement-reports', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<SettlementSnapshotRepository | TaxSettingRepository>()
    return handlers
      .handle('list', () => listSettlementReports().pipe(Effect.provideContext(context)))
      .handle('getProfitLoss', ({ params }) =>
        getProfitLossReport(params.fiscalYear).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('putProfitLoss', ({ params, payload, headers }) =>
        uploadProfitLoss(params.fiscalYear, payload, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('getCashFlow', ({ params }) =>
        getCashFlowReport(params.fiscalYear).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('putCashFlow', ({ params, payload, headers }) =>
        uploadCashFlow(params.fiscalYear, payload, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('getBalanceSheet', ({ params }) =>
        getBalanceSheetReport(params.fiscalYear).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('putBalanceSheet', ({ params, payload, headers }) =>
        uploadBalanceSheet(params.fiscalYear, payload, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('getReceivablePayable', ({ params }) =>
        getReceivablePayableReport(params.fiscalYear).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('putReceivablePayable', ({ params, payload, headers }) =>
        uploadReceivablePayable(params.fiscalYear, payload, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('getPartnerLedger', ({ params }) =>
        getPartnerLedger(
          params.fiscalYear,
          params.side === 'receivables' ? 'RECEIVABLE' : 'PAYABLE',
          params.partnerCode,
        ).pipe(Effect.provideContext(context)),
      )
  }),
)
