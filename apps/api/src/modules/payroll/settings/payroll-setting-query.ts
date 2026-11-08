import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { PayrollSettingRepository } from './payroll-setting-repository.ts'

/**
 * 다른 컨텍스트가 읽는 회사 급여 설정입니다. `payroll.public.ts`로 공개합니다.
 *
 * HR의 `CompanyWorkforceSize` 포트를 `src/wiring/hr-payroll.ts`에서 이 서비스로 구현합니다. 다른 컨텍스트가 내부에서 묻는
 * 것이라 플랜·권한을 보지 않고, HTTP로 열지 않습니다.
 */
export class PayrollSettingQuery extends Context.Service<
  PayrollSettingQuery,
  {
    /** 상시 5인 미만 사업장인지입니다. 설정을 저장한 적이 없으면 기본 설정의 `false`(5인 이상)입니다. */
    isUnderFiveEmployees(companyId: Id<'company'>): Effect.Effect<boolean>
  }
>()('semu/payroll/PayrollSettingQuery') {
  /** 급여 설정 저장소로 만듭니다. */
  static readonly layer = Layer.effect(
    PayrollSettingQuery,
    Effect.gen(function* () {
      const settings = yield* PayrollSettingRepository
      return PayrollSettingQuery.of({
        isUnderFiveEmployees: (companyId) =>
          settings.get(companyId).pipe(Effect.map((setting) => setting.underFiveEmployees)),
      })
    }),
  )
}
