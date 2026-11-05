import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { GrantRecord } from './grant.ts'

/** 지원사업 공고 저장소입니다. 회사에 속하지 않는 공용 데이터입니다. */
export class GrantRepository extends Context.Service<
  GrantRepository,
  {
    find(grantId: Id<'grant'>): Effect.Effect<Option.Option<GrantRecord>>
    list(): Effect.Effect<GrantRecord[]>
    save(grant: GrantRecord): Effect.Effect<void>
  }
>()('semu/assistant/GrantRepository') {
  /** `assistant_grants` 표에 둡니다. 회사 키가 없는 공용 표입니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<GrantRecord> = []) =>
    Layer.effect(
      GrantRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<GrantRecord>('assistant_grants', { seed })
        return GrantRepository.of({
          find: (grantId) => table.get(grantId),
          list: () => Effect.map(table.all(), (grants) => [...grants]),
          save: (grant) => table.put(grant),
        })
      }),
    )

  /** 프로세스 메모리에 공고를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<GrantRecord> = []) =>
    GrantRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
