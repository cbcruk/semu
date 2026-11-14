import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import {
  ACCESS_ERRORS,
  EmployeeNotFound,
  RateTableNotFound,
  WageSettlementExists,
  WageSettlementNotApplicable,
  WageSettlementNotFound,
  WageSettlementPaymentDateInvalid,
  WageSettlementTransitionInvalid,
  WithholdingFiled,
} from '../payroll-problems.ts'
import { YearMonthString } from '../payroll-schema.ts'
import { CreateWageTaxSettlement, UpdateWageTaxSettlement, WageTaxSettlement } from './wage-tax-settlement.ts'

const params = { settlementId: IdSchema('wageTaxSettlement') }
const ifMatch = { 'if-match': Schema.optionalKey(Schema.String) }
const WithEtag = HttpApiSchema.WithHeaders(WageTaxSettlement, { etag: Schema.String })
const WRITE_ERRORS = [
  ...ACCESS_ERRORS,
  VersionMismatch,
  WageSettlementNotFound,
  WageSettlementNotApplicable,
  WageSettlementExists,
  WageSettlementTransitionInvalid,
  WageSettlementPaymentDateInvalid,
  EmployeeNotFound,
  RateTableNotFound,
  WithholdingFiled,
] as const

function command<const Name extends string, const Path extends `/wage-tax-settlements/:settlementId::${string}`>(
  name: Name,
  path: Path,
) {
  return HttpApiEndpoint.post(name, path, { params, headers: ifMatch, success: WithEtag, error: WRITE_ERRORS })
}

/** 근로소득 정산(중도퇴사자 연말정산과 연말정산)입니다. 확정한 정산은 지급월 원천세의 A02·A04에 들어갑니다. */
export class WageTaxSettlementsGroup extends HttpApiGroup.make('wage-tax-settlements')
  .add(
    HttpApiEndpoint.get('list', '/wage-tax-settlements', {
      query: {
        year: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}$/)))),
        status: Schema.optionalKey(Schema.Literals(['CALCULATED', 'COMPLETED'])),
        /** 지급일이 이 달인 정산만 줍니다. 지급일이 없는 정산은 빠집니다. */
        paymentMonth: Schema.optionalKey(YearMonthString),
      },
      success: Schema.Struct({ items: Schema.Array(WageTaxSettlement) }),
      error: ACCESS_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.post('create', '/wage-tax-settlements', {
      payload: CreateWageTaxSettlement,
      success: HttpApiSchema.WithHeaders(WageTaxSettlement, { etag: Schema.String }).pipe(HttpApiSchema.status(201)),
      error: WRITE_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.get('get', '/wage-tax-settlements/:settlementId', {
      params,
      success: WithEtag,
      error: [...ACCESS_ERRORS, WageSettlementNotFound],
    }),
  )
  .add(
    HttpApiEndpoint.patch('update', '/wage-tax-settlements/:settlementId', {
      params,
      headers: ifMatch,
      payload: UpdateWageTaxSettlement,
      success: WithEtag,
      error: WRITE_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.delete('delete', '/wage-tax-settlements/:settlementId', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, WageSettlementNotFound, WageSettlementTransitionInvalid],
    }),
  )
  .add(command('complete', '/wage-tax-settlements/:settlementId::complete'))
  .add(command('reopen', '/wage-tax-settlements/:settlementId::reopen'))
  .middleware(Authentication) {}
