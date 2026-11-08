import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { SeveranceSettlementRepository } from './severance-settlement-repository.ts'
import type { SeveranceStatus } from './severance-settlement.types.ts'

/**
 * 직원별 퇴직금 정산 상태 조회입니다. `payroll.public.ts`로 공개합니다.
 *
 * HR의 `SeveranceSettlementLookup` 포트를 `src/wiring/hr-payroll.ts`에서 이 서비스로 구현합니다. 다른 컨텍스트가 묻는 것이라
 * 플랜·권한을 보지 않습니다.
 */
export class SeveranceSettlementQuery extends Context.Service<
  SeveranceSettlementQuery,
  {
    /** 그 직원의 모든 정산 상태입니다. 마지막 근무일 순이고, 정산이 없으면 빈 배열입니다. */
    statusesOf(companyId: Id<'company'>, employeeId: Id<'employee'>): Effect.Effect<ReadonlyArray<SeveranceStatus>>
  }
>()('semu/payroll/SeveranceSettlementQuery') {
  /** 퇴직금 정산 저장소로 만듭니다. */
  static readonly layer = Layer.effect(
    SeveranceSettlementQuery,
    Effect.gen(function* () {
      const settlements = yield* SeveranceSettlementRepository
      return SeveranceSettlementQuery.of({
        statusesOf: (companyId, employeeId) =>
          settlements
            .list(companyId)
            .pipe(
              Effect.map((all) =>
                all.filter((settlement) => settlement.employeeId === employeeId).map((settlement) => settlement.status),
              ),
            ),
      })
    }),
  )
}
