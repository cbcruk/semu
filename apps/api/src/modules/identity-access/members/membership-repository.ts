import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Membership } from './membership.ts'

/** 소속 저장소입니다. (회사, 사용자)마다 소속이 하나입니다. */
export class MembershipRepository extends Context.Service<
  MembershipRepository,
  {
    find(companyId: Id<'company'>, userId: Id<'user'>): Effect.Effect<Option.Option<Membership>>
    listByCompany(companyId: Id<'company'>): Effect.Effect<Membership[]>
    listByUser(userId: Id<'user'>): Effect.Effect<Membership[]>
    save(membership: Membership): Effect.Effect<void>
    remove(companyId: Id<'company'>, userId: Id<'user'>): Effect.Effect<void>
  }
>()('semu/identity-access/MembershipRepository') {
  /**
   * `iam_memberships` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다.
   *
   * 표의 키는 소속 ID입니다. 같은 (회사, 사용자)에 다른 ID의 소속을 저장하면 앞의 것을 지워 하나만 남깁니다.
   */
  static readonly layer = (seed: ReadonlyArray<Membership> = []) =>
    Layer.effect(
      MembershipRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<Membership>('iam_memberships', {
          seed,
          companyOf: (membership) => membership.companyId,
        })
        const byJoinedAt = (a: Membership, b: Membership): number => a.joinedAt.localeCompare(b.joinedAt)
        const find = (companyId: Id<'company'>, userId: Id<'user'>) =>
          Effect.map(table.byCompany(companyId), (memberships) =>
            Option.fromNullishOr(memberships.find((membership) => membership.userId === userId)),
          )
        return MembershipRepository.of({
          find,
          listByCompany: (companyId) =>
            Effect.map(table.byCompany(companyId), (memberships) => memberships.toSorted(byJoinedAt)),
          listByUser: (userId) =>
            Effect.map(table.all(), (memberships) =>
              memberships.filter((membership) => membership.userId === userId).sort(byJoinedAt),
            ),
          save: (membership) =>
            Effect.gen(function* () {
              const existing = yield* find(membership.companyId, membership.userId)
              if (Option.isSome(existing) && existing.value.id !== membership.id) yield* table.remove(existing.value.id)
              yield* table.put(membership)
            }),
          remove: (companyId, userId) =>
            Effect.flatMap(find(companyId, userId), (existing) =>
              Option.isSome(existing) ? table.remove(existing.value.id) : Effect.void,
            ),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 소속을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<Membership> = []) =>
    MembershipRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
