import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { nowAndToday } from '../common/lookup.ts'
import { requirePermission } from '../common/wire.ts'
import { ReportService } from './report-service.ts'

/** 실시간 보고서 핸들러입니다. */
export const ReportsHttpLive = HttpApiBuilder.group(
  Api,
  'reports',
  Effect.fn(function* (handlers) {
    const reports = yield* ReportService

    return handlers.handleAll({
      realtimeProfitLoss: ({ query }) =>
        Effect.flatMap(requirePermission('report:read'), (actor) =>
          reports.realtimeProfitLoss(actor.companyId, query.year, query.cumulative === 'true'),
        ),
      cashStatus: ({ query }) =>
        Effect.flatMap(requirePermission('report:read'), (actor) => reports.cashStatus(actor.companyId, query.date)),
      homeSummary: ({ query }) =>
        Effect.gen(function* () {
          const actor = yield* requirePermission('report:read')
          const today = query.date ?? (yield* nowAndToday).today
          return yield* reports.homeSummary(actor.companyId, actor.businessType, today)
        }),
      laborCost: ({ query }) =>
        Effect.gen(function* () {
          const actor = yield* authorize({ permission: 'settlement-report:read', plans: ['TAXATION'] }).pipe(
            Effect.catchTag('TermsReagreementRequired', Effect.die),
          )
          const months = yield* reports.laborCost(actor.companyId, query.year)
          return {
            year: query.year,
            months: months.map((row) => ({
              ...row,
              amounts: { ...row.amounts },
              paidHeadcount: { ...row.paidHeadcount },
            })),
          }
        }),
    })
  }),
)
