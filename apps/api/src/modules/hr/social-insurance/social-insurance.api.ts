import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { EmployeeKindNotSupported, EmployeeNotFound } from '../employees/employee.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { EmployeeId, IfMatchHeaders } from '../shared/hr-schemas.ts'
import {
  Enrollments,
  SocialInsuranceSetting,
  SocialInsuranceSettingInput,
  SocialInsuranceSettingInvalid,
  SocialInsuranceSettingNotFound,
} from './social-insurance-setting.ts'

const params = { id: EmployeeId }
const withEtag = HttpApiSchema.WithHeaders(SocialInsuranceSetting, { etag: Schema.String })

/**
 * 4대보험 자격 판정 결과입니다. 저장하지 않고 권장값만 돌려줍니다. 본문이 비면 급여가 그날 적용하는 가입 여부와 같습니다.
 */
export const EligibilityView = Schema.Struct({
  determinations: Schema.Array(Schema.String),
  messages: Schema.Array(Schema.String),
  recommended: Enrollments,
})

/**
 * 근로소득자의 4대보험 가입 설정과 자격 판정입니다. 설정은 `effectiveFrom` 이력으로 쌓고, `GET`은 기준일(`asOf`, 기본 오늘)에
 * 적용되는 설정과 같은 날의 판정, 판정과 다른 보험의 경고를 줍니다.
 */
export class SocialInsuranceApi extends HttpApiGroup.make('hrSocialInsurance')
  .add(
    HttpApiEndpoint.get('get', '/employees/:id/social-insurance', {
      params,
      query: { asOf: Schema.optionalKey(CalendarDate) },
      success: withEtag,
      error: [...ACCESS_ERRORS, EmployeeNotFound, SocialInsuranceSettingNotFound],
    }),
    HttpApiEndpoint.put('put', '/employees/:id/social-insurance', {
      params,
      headers: IfMatchHeaders,
      payload: SocialInsuranceSettingInput,
      success: withEtag,
      error: [
        ...ACCESS_ERRORS,
        EmployeeNotFound,
        EmployeeKindNotSupported,
        SocialInsuranceSettingInvalid,
        VersionMismatch,
      ],
    }),
    HttpApiEndpoint.post('determine', '/employees/:id/social-insurance::determine', {
      params,
      query: { asOf: Schema.optionalKey(CalendarDate) },
      payload: Schema.Struct({
        weeklyWorkHours: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))),
        isRepresentativeOrExecutive: Schema.optionalKey(Schema.Boolean),
        isRepresentativeRelative: Schema.optionalKey(Schema.Boolean),
      }),
      success: EligibilityView,
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
  )
  .middleware(Authentication) {}
