import { DateTime, Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { stripUndefined } from '../shared/tenant-table.ts'
import { DEFAULT_ENROLLMENT, determineEligibility } from './insurance-eligibility.ts'

/** 4대보험 자격 판정 핸들러입니다. */
export const SocialInsuranceHttpLive = HttpApiBuilder.group(
  Api,
  'hrSocialInsurance',
  Effect.fn(function* (handlers) {
    const employees = yield* EmployeeRepository

    return handlers.handleAll({
      determine: ({ params, payload }) =>
        Effect.gen(function* () {
          const actor = yield* authorize(hrAccess('employee:read'))
          const employee = yield* employees
            .find(actor.companyId, params.id)
            .pipe(
              Effect.flatMap(
                Option.match({ onNone: () => Effect.fail(new EmployeeNotFound({})), onSome: Effect.succeed }),
              ),
            )
          const now = yield* DateTime.now
          const result = determineEligibility(
            {
              birthDate: employee.birthDate,
              joinDate: employee.joinDate,
              isForeigner: employee.isForeigner,
              visaCode: employee.visaCode,
              nationalityCode: employee.nationalityCode,
              weeklyWorkHours: payload.weeklyWorkHours,
              isRepresentativeOrExecutive: payload.isRepresentativeOrExecutive ?? false,
              isRepresentativeRelative: payload.isRepresentativeRelative ?? false,
            },
            DEFAULT_ENROLLMENT,
            companyDate(DateTime.toEpochMillis(now)),
          )
          return {
            ...result,
            recommended: {
              nps: stripUndefined(result.recommended.nps),
              nhis: stripUndefined(result.recommended.nhis),
              ei: stripUndefined(result.recommended.ei),
              iais: stripUndefined(result.recommended.iais),
            },
          }
        }),
    })
  }),
)
