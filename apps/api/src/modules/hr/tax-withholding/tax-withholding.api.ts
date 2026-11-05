import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { EmployeeKindNotSupported, EmployeeNotFound } from '../employees/employee.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { EmployeeId, IfMatchHeaders } from '../shared/hr-schemas.ts'
import {
  TaxWithholding,
  TaxWithholdingInput,
  TaxWithholdingInvalid,
  TaxWithholdingNotFound,
} from './tax-withholding.ts'

const params = { id: EmployeeId }
const withEtag = HttpApiSchema.WithHeaders(TaxWithholding, { etag: Schema.String })

/**
 * 근로소득자의 소득세 공제 설정입니다. `effectiveFrom` 이력으로 쌓고, `GET`은 기준일(`asOf`, 기본 오늘)에 적용되는 설정을 줍니다.
 *
 * 감면 유형·사유·기간·감면율과 조정비율은 `deduction-validation` 규칙으로 검사합니다.
 */
export class TaxWithholdingApi extends HttpApiGroup.make('hrTaxWithholding')
  .add(
    HttpApiEndpoint.get('get', '/employees/:id/tax-withholding', {
      params,
      query: { asOf: Schema.optionalKey(CalendarDate) },
      success: withEtag,
      error: [...ACCESS_ERRORS, EmployeeNotFound, TaxWithholdingNotFound],
    }),
    HttpApiEndpoint.put('put', '/employees/:id/tax-withholding', {
      params,
      headers: IfMatchHeaders,
      payload: TaxWithholdingInput,
      success: withEtag,
      error: [...ACCESS_ERRORS, EmployeeNotFound, EmployeeKindNotSupported, TaxWithholdingInvalid, VersionMismatch],
    }),
  )
  .middleware(Authentication) {}
