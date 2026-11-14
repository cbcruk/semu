import { Effect, Layer } from 'effect'
import { CompanyWorkforceSize, SeveranceSettlementLookup } from '../modules/hr/hr.public.ts'
import { PayrollSettingQuery, SeveranceSettlementQuery } from '../modules/payroll/payroll.public.ts'

/**
 * HR의 `SeveranceSettlementLookup` 포트를 Payroll의 `SeveranceSettlementQuery`로 구현합니다.
 *
 * 종류(`RETIREMENT`·`INTERIM`)와 상태 값(`CALCULATED`·`COMPLETED`·`EXCLUDED`)은 두 컨텍스트가 같아 그대로 넘깁니다.
 * 어느 정산이 HR 커맨드를 막는지는 HR 규칙(`isSeveranceSettled`, `latestCompletedInterimDate`)이 정합니다.
 */
export const HrSeveranceSettlementLookupFromPayroll: Layer.Layer<
  SeveranceSettlementLookup,
  never,
  SeveranceSettlementQuery
> = Layer.effect(
  SeveranceSettlementLookup,
  Effect.gen(function* () {
    const payroll = yield* SeveranceSettlementQuery
    return SeveranceSettlementLookup.of({
      settlementsOf: (companyId, employeeId) => payroll.settlementsOf(companyId, employeeId),
    })
  }),
)

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
