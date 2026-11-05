import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `iam_users` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<UserRecord> = []) =>
    Layer.effect(
      UserRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<UserRecord>('iam_users', { seed })
        return UserRepository.of({
          findById: (id) => table.get(id),
          findByEmail: (email) =>
            Effect.map(table.all(), (users) => Option.fromNullishOr(users.find((user) => user.email === email))),
          listByManager: (managerId) =>
            Effect.map(table.all(), (users) => users.filter((user) => user.managerId === managerId)),
          save: (user) => table.put(user),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 사용자를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<UserRecord> = []) =>
    UserRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
