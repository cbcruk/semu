import { Clock, Effect } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { eachCompany } from '../../../shared/scheduler/scheduler.ts'
import type { ScheduledTask } from '../../../shared/scheduler/scheduler.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { PayrollPlanCheck } from '../ports/payroll-plan-check.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'
import { createScheduledRegularLedger } from './payroll-ledgers.ts'
import type { LedgerDeps } from './payroll-ledgers.ts'

/**
 * 매일 04:00(회사 시간대)에 정기 대장 자동 생성을 켠 회사마다 한 트랜잭션으로 {@link createScheduledRegularLedger}를 부릅니다.
 * 임금산정 기간이 시작한 날 새벽에 그 귀속월 대장이 생기고, 그 뒤 날들은 대장이 있어 건너뜁니다. 서버가 시작일에 꺼져 있었어도
 * 기간 안의 다음 실행에서 만듭니다.
 *
 * 결과는 회사별 결과(`CREATED`·`EXISTS`·`DISABLED`·`NO_PLAN`·`WITHHOLDING_FILED`)의 개수입니다.
 */
export const regularLedgerTask: ScheduledTask<LedgerDeps | PayrollPlanCheck | UnitOfWork> = {
  name: 'payroll.regular-ledger',
  spec: { kind: 'DAILY', at: '04:00' },
  run: () =>
    Effect.gen(function* () {
      const companies = yield* (yield* PayrollSettingRepository).companiesAutoCreatingLedgers()
      const today = companyDate(yield* Clock.currentTimeMillis)
      const { results } = yield* eachCompany(
        companies,
        (companyId) => companyId,
        (companyId: Id<'company'>) => createScheduledRegularLedger(companyId, today),
      )
      const counts: Record<string, number> = {}
      for (const { result } of results) counts[result] = (counts[result] ?? 0) + 1
      return { companies: results.length, ...counts }
    }),
}
