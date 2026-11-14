import { Effect } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { eachCompany } from '../../../shared/scheduler/scheduler.ts'
import type { ScheduledTask } from '../../../shared/scheduler/scheduler.ts'
import { IntegrationRepository } from '../integrations/integration-repository.ts'
import { scheduledScraps } from './scrap-schedule.ts'
import type { ScheduledScrap } from './scrap-schedule.ts'
import { ScrapRequests } from './scrap-requests.ts'

type Requirements = ScrapRequests | IntegrationRepository | UnitOfWork

/**
 * 정기 수집 작업 하나입니다. 그 기관 종류의 연동이 있는 회사마다 한 트랜잭션으로 `ScrapRequests.requestScheduled`를 부릅니다.
 * 요청은 슬롯마다 멱등이라 재시도해도 같은 슬롯의 요청을 다시 만들지 않습니다. 수집 자체는 큐의 워커가 합니다.
 */
export const scheduledScrapTask = (scrap: ScheduledScrap): ScheduledTask<Requirements> => ({
  name: scrap.name,
  spec: { kind: 'DAILY', at: scrap.at },
  run: (slot) =>
    Effect.gen(function* () {
      const companies = yield* (yield* IntegrationRepository).companiesWith(scrap.institutionType)
      const service = yield* ScrapRequests
      const { results } = yield* eachCompany(
        companies,
        (companyId) => companyId,
        (companyId: Id<'company'>) => service.requestScheduled(companyId, scrap.institutionType, slot.key),
      )
      const counts: Record<string, number> = {}
      for (const { result } of results) counts[result] = (counts[result] ?? 0) + 1
      return { companies: results.length, ...counts }
    }),
})

/** 정기 수집 작업 전체입니다. */
export const scheduledScrapTasks: ReadonlyArray<ScheduledTask<Requirements>> = scheduledScraps().map(scheduledScrapTask)
