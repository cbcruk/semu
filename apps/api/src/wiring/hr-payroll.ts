import { Effect, Layer } from 'effect'
import { CompanyWorkforceSize } from '../modules/hr/hr.public.ts'
import { PayrollSettingQuery } from '../modules/payroll/payroll.public.ts'

/**
 * HR의 `CompanyWorkforceSize` 포트를 Payroll의 `PayrollSettingQuery`로 구현합니다.
 *
 * 급여 설정의 5인 미만 여부를 뒤집어 넘깁니다. 설정을 저장한 적이 없는 회사는 Payroll 기본 설정을 따라 5명 이상입니다.
 */
export const HrCompanyWorkforceSizeFromPayroll: Layer.Layer<CompanyWorkforceSize, never, PayrollSettingQuery> =
  Layer.effect(
    CompanyWorkforceSize,
    Effect.gen(function* () {
      const payroll = yield* PayrollSettingQuery
      return CompanyWorkforceSize.of({
        hasFiveOrMoreEmployees: (companyId) =>
          payroll.isUnderFiveEmployees(companyId).pipe(Effect.map((underFive) => !underFive)),
      })
    }),
  )
