import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { EmployeeId, InsuranceFilingId } from '../shared/hr-schemas.ts'
import {
  InsuranceFilingKindSchema,
  InsuranceFilingNotFound,
  InsuranceFilingStatusSchema,
  InsuranceFilingTransitionInvalid,
  InsuranceFilingView,
} from './insurance-filing.ts'

const params = { insuranceFilingId: InsuranceFilingId }

/**
 * 4대보험 신고 큐입니다. 목록·조회는 `insurance-filing:read`, 완료·실패는 대리인 전용 `insurance-filing:process`입니다.
 * 처리는 열린 신고(`PENDING`·`FAILED`)만 되고, 닫힌 신고는 409 `INSURANCE_FILING_TRANSITION_INVALID`입니다.
 */
export class InsuranceFilingsApi extends HttpApiGroup.make('hrInsuranceFilings')
  .add(
    HttpApiEndpoint.get('list', '/insurance-filings', {
      query: {
        status: Schema.optionalKey(InsuranceFilingStatusSchema),
        employeeId: Schema.optionalKey(EmployeeId),
        kind: Schema.optionalKey(InsuranceFilingKindSchema),
      },
      success: Schema.Struct({ items: Schema.Array(InsuranceFilingView) }),
      error: [...ACCESS_ERRORS],
    }),
    HttpApiEndpoint.get('get', '/insurance-filings/:insuranceFilingId', {
      params,
      success: InsuranceFilingView,
      error: [...ACCESS_ERRORS, InsuranceFilingNotFound],
    }),
    HttpApiEndpoint.post('complete', '/insurance-filings/:insuranceFilingId::complete', {
      params,
      success: InsuranceFilingView,
      error: [...ACCESS_ERRORS, InsuranceFilingNotFound, InsuranceFilingTransitionInvalid],
    }),
    HttpApiEndpoint.post('fail', '/insurance-filings/:insuranceFilingId::fail', {
      params,
      payload: Schema.Struct({ message: Schema.NonEmptyString }),
      success: InsuranceFilingView,
      error: [...ACCESS_ERRORS, InsuranceFilingNotFound, InsuranceFilingTransitionInvalid],
    }),
  )
  .middleware(Authentication) {}
