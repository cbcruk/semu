import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import {
  ACCESS_ERRORS,
  EmployeeNotFound,
  RateTableNotFound,
  SeveranceInterimDateInvalid,
  SeveranceLaterSettlementCompleted,
  SeveranceNotApplicable,
  SeverancePaymentDateInvalid,
  SeveranceServiceStartChanged,
  SeveranceRetirementMismatch,
  SeveranceSettlementExists,
  SeveranceSettlementNotFound,
  SeveranceTransitionInvalid,
  WithholdingFiled,
} from '../payroll-problems.ts'
import { CalendarDate, YearMonthString } from '../payroll-schema.ts'
import {
  CreateSeveranceSettlement,
  SeveranceSettlement,
  SeveranceSettlementCandidate,
  UpdateSeveranceSettlement,
} from './severance-settlement.ts'

const params = { settlementId: IdSchema('severanceSettlement') }
const ifMatch = { 'if-match': Schema.optionalKey(Schema.String) }
const WithEtag = HttpApiSchema.WithHeaders(SeveranceSettlement, { etag: Schema.String })
const WRITE_ERRORS = [
  ...ACCESS_ERRORS,
  VersionMismatch,
  SeveranceSettlementNotFound,
  SeveranceTransitionInvalid,
  SeveranceNotApplicable,
  SeverancePaymentDateInvalid,
  SeveranceRetirementMismatch,
  SeveranceSettlementExists,
  SeveranceInterimDateInvalid,
  SeveranceServiceStartChanged,
  SeveranceLaterSettlementCompleted,
  EmployeeNotFound,
  RateTableNotFound,
  WithholdingFiled,
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
      query: {
        status: Schema.optionalKey(Schema.Literals(['CALCULATED', 'COMPLETED', 'EXCLUDED'])),
        /** 지급일이 이 달인 정산만 줍니다. 지급일이 없는 정산은 빠집니다. */
        paymentMonth: Schema.optionalKey(YearMonthString),
      },
      success: Schema.Struct({ items: Schema.Array(SeveranceSettlement) }),
      error: ACCESS_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.get('candidates', '/severance-settlement-candidates', {
      query: {
        /** 퇴직일이 이 날 이후인 직원입니다. 기본값은 3년 전 오늘입니다(퇴직금 청구권 소멸시효). */
        from: Schema.optionalKey(CalendarDate),
        /** 퇴직일이 이 날 이전인 직원입니다. 기본값은 오늘입니다. */
        to: Schema.optionalKey(CalendarDate),
      },
      success: Schema.Struct({ items: Schema.Array(SeveranceSettlementCandidate) }),
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
      payload: UpdateSeveranceSettlement,
      success: WithEtag,
      error: WRITE_ERRORS,
    }),
  )
  .add(command('complete', '/severance-settlements/:settlementId::complete'))
  .add(command('reopen', '/severance-settlements/:settlementId::reopen'))
  .add(command('exclude', '/severance-settlements/:settlementId::exclude'))
  .add(command('include', '/severance-settlements/:settlementId::include'))
  .middleware(Authentication) {}
