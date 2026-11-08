import { Effect, Layer } from 'effect'
import { SeveranceSettlementLookup } from '../modules/hr/hr.public.ts'
import { SeveranceSettlementQuery } from '../modules/payroll/payroll.public.ts'

/**
 * HR의 `SeveranceSettlementLookup` 포트를 Payroll의 `SeveranceSettlementQuery`로 구현합니다.
 *
 * 상태 값(`CALCULATED`·`COMPLETED`·`EXCLUDED`)은 두 컨텍스트가 같아 그대로 넘깁니다. 어느 상태가 HR 커맨드를 막는지는
 * HR 규칙(`isSeveranceSettled`)이 정합니다.
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
      statusesOf: (companyId, employeeId) => payroll.statusesOf(companyId, employeeId),
    })
  }),
)
