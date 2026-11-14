import { Clock, Effect } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import type { ScheduledTask } from '../../../shared/scheduler/scheduler.ts'
import { mergeGrantFeed } from './grant-feed.ts'
import { GrantFeedSource } from './grant-feed-source.ts'
import { GrantRepository } from './grant-repository.ts'

/**
 * 매일 04:00(회사 시간대)에 공고 원천을 읽어 저장된 공고에 합칩니다({@link mergeGrantFeed}). 회사에 속하지 않는 공용 데이터라
 * 회사별로 나누지 않고 한 트랜잭션입니다. 원천을 읽지 못하면(`GrantFeedUnavailable`) 실패로 남기고 재시도합니다.
 *
 * 원천은 트랜잭션 밖에서 읽습니다. 바깥 호출을 기다리는 동안 쓰기 잠금을 잡지 않기 위해서입니다. 결과는 원천 공고 수와 새로 만든·고친
 * 공고 수입니다.
 */
export const grantFeedTask: ScheduledTask<GrantFeedSource | GrantRepository | UnitOfWork> = {
  name: 'assistant.grant-feed',
  spec: { kind: 'DAILY', at: '04:00' },
  run: () =>
    Effect.gen(function* () {
      const notices = yield* (yield* GrantFeedSource).notices()
      const repository = yield* GrantRepository
      return yield* (yield* UnitOfWork).run(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const { created, updated } = mergeGrantFeed(yield* repository.list(), notices, () => newId('grant', now))
          yield* Effect.forEach([...created, ...updated], (grant) => repository.save(grant), { discard: true })
          return { notices: notices.length, created: created.length, updated: updated.length }
        }),
      )
    }),
}
