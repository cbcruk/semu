import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import {
  EntitlementRequired,
  PermissionDenied,
  TermsReagreementRequired,
  VersionMismatch,
} from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import {
  BalanceSheetReport,
  BalanceSheetUploadBody,
  CashFlowReport,
  CashFlowUploadBody,
  ProfitLossReport,
  ProfitLossUploadBody,
  SettlementReportList,
  SettlementReportNotFound,
  SettlementSnapshotInvalid,
} from './settlement-report.ts'

const FiscalYear = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 2000, maximum: 2100 })),
)
const params = { fiscalYear: FiscalYear }
const WithEtag = HttpApiSchema.WithHeaders(ProfitLossReport, { etag: Schema.String })
const CashFlowWithEtag = HttpApiSchema.WithHeaders(CashFlowReport, { etag: Schema.String })
const BalanceSheetWithEtag = HttpApiSchema.WithHeaders(BalanceSheetReport, { etag: Schema.String })
const ACCESS_ERRORS = [PermissionDenied, EntitlementRequired, TermsReagreementRequired] as const

/**
 * 결산 기반 세무 보고서입니다. 담당자가 ERP에서 결산한 뒤 올린 스냅샷을 보여 줍니다. 실시간 보고서(`/reports/*`, Bookkeeping)와
 * 숫자가 다를 수 있습니다. 지금은 손익계산서, 자금 흐름, 재무상태표가 있습니다.
 */
export class SettlementReportsApi extends HttpApiGroup.make('settlement-reports')
  .add(
    HttpApiEndpoint.get('list', '/settlement-reports', { success: SettlementReportList, error: ACCESS_ERRORS }),
    HttpApiEndpoint.get('getProfitLoss', '/settlement-reports/profit-loss/:fiscalYear', {
      params,
      success: WithEtag,
      error: [...ACCESS_ERRORS, SettlementReportNotFound],
    }),
    HttpApiEndpoint.put('putProfitLoss', '/settlement-reports/profit-loss/:fiscalYear', {
      params,
      headers: { 'if-match': Schema.optionalKey(Schema.String) },
      payload: ProfitLossUploadBody,
      success: WithEtag,
      error: [...ACCESS_ERRORS, VersionMismatch, SettlementSnapshotInvalid],
    }),
    HttpApiEndpoint.get('getCashFlow', '/settlement-reports/cash-flow/:fiscalYear', {
      params,
      success: CashFlowWithEtag,
      error: [...ACCESS_ERRORS, SettlementReportNotFound],
    }),
    HttpApiEndpoint.put('putCashFlow', '/settlement-reports/cash-flow/:fiscalYear', {
      params,
      headers: { 'if-match': Schema.optionalKey(Schema.String) },
      payload: CashFlowUploadBody,
      success: CashFlowWithEtag,
      error: [...ACCESS_ERRORS, VersionMismatch, SettlementSnapshotInvalid],
    }),
    HttpApiEndpoint.get('getBalanceSheet', '/settlement-reports/balance-sheet/:fiscalYear', {
      params,
      success: BalanceSheetWithEtag,
      error: [...ACCESS_ERRORS, SettlementReportNotFound],
    }),
    HttpApiEndpoint.put('putBalanceSheet', '/settlement-reports/balance-sheet/:fiscalYear', {
      params,
      headers: { 'if-match': Schema.optionalKey(Schema.String) },
      payload: BalanceSheetUploadBody,
      success: BalanceSheetWithEtag,
      error: [...ACCESS_ERRORS, VersionMismatch, SettlementSnapshotInvalid],
    }),
  )
  .middleware(Authentication) {}
