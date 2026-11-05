import { Context, Effect, Layer, Option, Ref } from 'effect'
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
  /** `seed`로 시작해 프로세스 메모리에 소속을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<Membership> = []) =>
    Layer.effect(
      MembershipRepository,
      Effect.gen(function* () {
        const key = (companyId: string, userId: string): string => `${companyId}/${userId}`
        const store = yield* Ref.make(new Map(seed.map((m) => [key(m.companyId, m.userId), m])))
        const all = Ref.get(store).pipe(Effect.map((memberships) => [...memberships.values()]))
        return MembershipRepository.of({
          find: (companyId, userId) =>
            Ref.get(store).pipe(
              Effect.map((memberships) => Option.fromNullishOr(memberships.get(key(companyId, userId)))),
            ),
          listByCompany: (companyId) =>
            all.pipe(
              Effect.map((memberships) =>
                memberships
                  .filter((m) => m.companyId === companyId)
                  .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
              ),
            ),
          listByUser: (userId) =>
            all.pipe(
              Effect.map((memberships) =>
                memberships.filter((m) => m.userId === userId).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
              ),
            ),
          save: (membership) =>
            Ref.update(store, (memberships) =>
              new Map(memberships).set(key(membership.companyId, membership.userId), membership),
            ),
          remove: (companyId, userId) =>
            Ref.update(store, (memberships) => {
              const next = new Map(memberships)
              next.delete(key(companyId, userId))
              return next
            }),
        })
      }),
    )
}
