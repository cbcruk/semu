import { Context, Effect, Layer, Option, Ref } from 'effect'
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
  /** 프로세스 메모리에 공고를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<GrantRecord> = []) =>
    Layer.effect(
      GrantRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((grant) => [grant.id, grant])))
        return GrantRepository.of({
          find: (grantId) => Ref.get(store).pipe(Effect.map((grants) => Option.fromNullishOr(grants.get(grantId)))),
          list: () => Ref.get(store).pipe(Effect.map((grants) => [...grants.values()])),
          save: (grant) => Ref.update(store, (grants) => new Map(grants).set(grant.id, grant)),
        })
      }),
    )
}
