import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import {
  ACCESS_ERRORS,
  EmployeeNotFound,
  RateTableNotFound,
  SeveranceNotApplicable,
  SeveranceSettlementExists,
  SeveranceSettlementNotFound,
  SeveranceTransitionInvalid,
} from '../payroll-problems.ts'
import { CreateSeveranceSettlement, SeveranceInputSchema, SeveranceSettlement } from './severance-settlement.ts'

const params = { settlementId: IdSchema('severanceSettlement') }
const ifMatch = { 'if-match': Schema.optionalKey(Schema.String) }
const WithEtag = HttpApiSchema.WithHeaders(SeveranceSettlement, { etag: Schema.String })
const WRITE_ERRORS = [
  ...ACCESS_ERRORS,
  VersionMismatch,
  SeveranceSettlementNotFound,
  SeveranceTransitionInvalid,
  SeveranceNotApplicable,
  SeveranceSettlementExists,
  EmployeeNotFound,
  RateTableNotFound,
] as const

function command<const Name extends string, const Path extends `/severance-settlements/:settlementId::${string}`>(
  name: Name,
  path: Path,
) {
  return HttpApiEndpoint.post(name, path, { params, headers: ifMatch, success: WithEtag, error: WRITE_ERRORS })
}

/** 퇴직금 정산입니다(현행 급여 > 퇴직금 정산). */
export class SeveranceSettlementsGroup extends HttpApiGroup.make('severance-settlements')
  .add(
    HttpApiEndpoint.get('list', '/severance-settlements', {
      query: { status: Schema.optionalKey(Schema.Literals(['CALCULATED', 'COMPLETED', 'EXCLUDED'])) },
      success: Schema.Struct({ items: Schema.Array(SeveranceSettlement) }),
      error: ACCESS_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.post('create', '/severance-settlements', {
      payload: CreateSeveranceSettlement,
      success: HttpApiSchema.WithHeaders(SeveranceSettlement, { etag: Schema.String }).pipe(HttpApiSchema.status(201)),
      error: WRITE_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.get('get', '/severance-settlements/:settlementId', {
      params,
      success: WithEtag,
      error: [...ACCESS_ERRORS, SeveranceSettlementNotFound],
    }),
  )
  .add(
    HttpApiEndpoint.patch('update', '/severance-settlements/:settlementId', {
      params,
      headers: ifMatch,
      payload: Schema.Struct({ input: SeveranceInputSchema }),
      success: WithEtag,
      error: WRITE_ERRORS,
    }),
  )
  .add(command('complete', '/severance-settlements/:settlementId::complete'))
  .add(command('reopen', '/severance-settlements/:settlementId::reopen'))
  .add(command('exclude', '/severance-settlements/:settlementId::exclude'))
  .add(command('include', '/severance-settlements/:settlementId::include'))
  .middleware(Authentication) {}
