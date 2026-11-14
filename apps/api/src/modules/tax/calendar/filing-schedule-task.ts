import { Effect } from 'effect'
import type { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { eachCompany } from '../../../shared/scheduler/scheduler.ts'
import type { ScheduledTask } from '../../../shared/scheduler/scheduler.ts'
import { FilingScheduler } from './filing-scheduler.ts'
import { TaxProfiles } from './tax-profiles.ts'

/**
 * 신고 일정 배치를 매일 03:00(회사 시간대)에 돌립니다. 세무 기장 회사마다 한 트랜잭션으로 `runFor`를 부르고, 한 회사가 실패해도
 * 나머지 회사는 끝냅니다. 같은 날 다시 돌려도 결과가 같아(`FilingScheduler`) 실패한 슬롯을 통째로 다시 돌립니다.
 *
 * 결과는 회사별 `{ created, refreshed, restored, canceled }`의 합계입니다.
 */
export const filingScheduleTask: ScheduledTask<FilingScheduler | TaxProfiles | UnitOfWork> = {
  name: 'tax.filing-schedule',
  spec: { kind: 'DAILY', at: '03:00' },
  run: () =>
    Effect.gen(function* () {
      const profiles = yield* (yield* TaxProfiles).listTaxation()
      const scheduler = yield* FilingScheduler
      const { succeeded, results } = yield* eachCompany(
        profiles,
        (profile) => profile.companyId,
        (profile) => scheduler.runFor(profile),
      )
      const total = (pick: (result: (typeof results)[number]['result']) => number) =>
        results.reduce((sum, { result }) => sum + pick(result), 0)
      return {
        companies: succeeded,
        created: total((result) => result.created),
        refreshed: total((result) => result.refreshed),
        restored: total((result) => result.restored),
        canceled: total((result) => result.canceled),
      }
    }),
}
