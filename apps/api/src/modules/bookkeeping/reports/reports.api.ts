import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { EntitlementRequired, PermissionDenied } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { CalendarDate, QueryFlag, YearQuery } from '../common/wire.ts'
import { CashStatus, HomeSummary, LaborCostReport, RealtimeProfitLoss } from './report.ts'

/**
 * 실시간 보고서입니다. 저장하지 않고 요청마다 계산합니다.
 *
 * 홈 실시간 손익·자금 현황은 플랜 없이 보고, 세무 보고서(인건비)는 `TAXATION` 플랜이 필요합니다.
 */
export class ReportsApi extends HttpApiGroup.make('reports')
  .add(
    HttpApiEndpoint.get('realtimeProfitLoss', '/reports/realtime-pl', {
      query: Schema.Struct({
        year: YearQuery,
        /** 각 달을 1월부터의 누계로 줍니다. 기본은 `false`입니다. */
        cumulative: Schema.optionalKey(QueryFlag),
      }),
      success: RealtimeProfitLoss,
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('cashStatus', '/reports/cash-status', {
      query: Schema.Struct({ date: CalendarDate }),
      success: CashStatus,
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('homeSummary', '/reports/home-summary', {
      query: Schema.Struct({
        /** 기준일입니다. 없으면 오늘(회사 시간대)입니다. */
        date: Schema.optionalKey(CalendarDate),
      }),
      success: HomeSummary,
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('laborCost', '/reports/labor-cost', {
      query: Schema.Struct({ year: YearQuery }),
      success: LaborCostReport,
      error: [PermissionDenied, EntitlementRequired],
    }),
  )
  .middleware(Authentication) {}
