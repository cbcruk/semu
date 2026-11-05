import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { UserRecord } from './user.ts'

/** 사용자 저장소입니다. 이메일은 정규화한 값으로 유일합니다. */
export class UserRepository extends Context.Service<
  UserRepository,
  {
    findById(id: Id<'user'>): Effect.Effect<Option.Option<UserRecord>>
    findByEmail(normalizedEmail: string): Effect.Effect<Option.Option<UserRecord>>
    /** 팀장 아래 담당자 목록입니다. */
    listByManager(managerId: Id<'user'>): Effect.Effect<UserRecord[]>
    save(user: UserRecord): Effect.Effect<void>
  }
>()('semu/identity-access/UserRepository') {
  /** `seed`로 시작해 프로세스 메모리에 사용자를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<UserRecord> = []) =>
    Layer.effect(
      UserRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((user) => [user.id, user])))
        const all = Ref.get(store).pipe(Effect.map((users) => [...users.values()]))
        return UserRepository.of({
          findById: (id) => Ref.get(store).pipe(Effect.map((users) => Option.fromNullishOr(users.get(id)))),
          findByEmail: (email) =>
            all.pipe(Effect.map((users) => Option.fromNullishOr(users.find((user) => user.email === email)))),
          listByManager: (managerId) => all.pipe(Effect.map((users) => users.filter((u) => u.managerId === managerId))),
          save: (user) => Ref.update(store, (users) => new Map(users).set(user.id, user)),
        })
      }),
    )
}
