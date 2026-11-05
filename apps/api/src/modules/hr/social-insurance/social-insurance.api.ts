import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Authentication } from '../../identity-access/authentication.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { EmployeeId } from '../shared/hr-schemas.ts'

const Enrollment = Schema.Struct({
  enrolled: Schema.Boolean,
  exclusionReason: Schema.optionalKey(Schema.String),
})

/** 4대보험 자격 판정 결과입니다. 저장하지 않고 권장값만 돌려줍니다. */
export const EligibilityView = Schema.Struct({
  determinations: Schema.Array(Schema.String),
  messages: Schema.Array(Schema.String),
  recommended: Schema.Struct({ nps: Enrollment, nhis: Enrollment, ei: Enrollment, iais: Enrollment }),
})

/** 4대보험 자격 판정입니다. 직원 정보와 본문의 근로 조건으로 권장 가입 여부를 계산합니다. */
export class SocialInsuranceApi extends HttpApiGroup.make('hrSocialInsurance')
  .add(
    HttpApiEndpoint.post('determine', '/employees/:id/social-insurance::determine', {
      params: { id: EmployeeId },
      payload: Schema.Struct({
        weeklyWorkHours: Schema.optionalKey(Schema.Number),
        isRepresentativeOrExecutive: Schema.optionalKey(Schema.Boolean),
        isRepresentativeRelative: Schema.optionalKey(Schema.Boolean),
      }),
      success: EligibilityView,
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
  )
  .middleware(Authentication) {}
