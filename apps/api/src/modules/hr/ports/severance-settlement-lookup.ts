import { Context, type Effect } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { SeveranceSettlementStatus } from '../retirement/retirement.types.ts'

/**
 * 직원의 퇴직금 정산 상태를 묻는 포트입니다. 정산은 Payroll이 소유하고 `src/wiring/hr-payroll.ts`가 구현합니다.
 *
 * HR은 정산 상태를 저장하지 않고, 직원 삭제·퇴사 취소·다시 퇴사 때 이 포트로 물어 409 `RETIREMENT_COMPLETED`를 판정합니다
 * (2026-11-08 결정, docs/design/payroll.md 열린 질문 16). 상태 값은 Payroll과 같아 옮길 때 바꾸지 않습니다.
 */
export class SeveranceSettlementLookup extends Context.Service<
  SeveranceSettlementLookup,
  {
    /** 그 직원의 모든 퇴직금 정산 상태입니다. 정산이 여럿이면 모두, 없으면 빈 배열입니다. 플랜·권한은 보지 않습니다. */
    statusesOf(
      companyId: Id<'company'>,
      employeeId: Id<'employee'>,
    ): Effect.Effect<ReadonlyArray<SeveranceSettlementStatus>>
  }
>()('semu/hr/SeveranceSettlementLookup') {}
