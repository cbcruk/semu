import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { SessionRecord } from './session.ts'

/** 세션 저장소입니다. */
export class SessionRepository extends Context.Service<
  SessionRepository,
  {
    findById(id: Id<'session'>): Effect.Effect<Option.Option<SessionRecord>>
    /** onboarding token 해시가 같은 폐기되지 않은 세션입니다. 만료는 호출하는 쪽이 봅니다. */
    findByOnboardingTokenHash(tokenHash: string): Effect.Effect<Option.Option<SessionRecord>>
    /** 폐기되지 않은 사용자 세션입니다. */
    listActiveByUser(userId: Id<'user'>): Effect.Effect<SessionRecord[]>
    save(session: SessionRecord): Effect.Effect<void>
  }
>()('semu/identity-access/SessionRepository') {
  /** `iam_sessions` 표에 둡니다. refresh token 계열이 재시작 뒤에도 남습니다. */
  static readonly layer = (seed: ReadonlyArray<SessionRecord> = []) =>
    Layer.effect(
      SessionRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<SessionRecord>('iam_sessions', { seed })
        return SessionRepository.of({
          findById: (id) => table.get(id),
          findByOnboardingTokenHash: (tokenHash) =>
            Effect.map(table.all(), (sessions) =>
              Option.fromNullishOr(
                sessions.find((s) => s.onboardingTokenHash === tokenHash && s.revokedAt === undefined),
              ),
            ),
          listActiveByUser: (userId) =>
            Effect.map(table.all(), (sessions) =>
              sessions.filter((s) => s.userId === userId && s.revokedAt === undefined),
            ),
          save: (session) => table.put(session),
        })
      }),
    )

  /** 프로세스 메모리에 세션을 둡니다. */
  static readonly layerMemory = (seed: ReadonlyArray<SessionRecord> = []) =>
    SessionRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
