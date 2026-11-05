import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { SessionRecord } from './session.ts'

/** 세션 저장소입니다. */
export class SessionRepository extends Context.Service<
  SessionRepository,
  {
    findById(id: Id<'session'>): Effect.Effect<Option.Option<SessionRecord>>
    findByOnboardingToken(token: string): Effect.Effect<Option.Option<SessionRecord>>
    /** 폐기되지 않은 사용자 세션입니다. */
    listActiveByUser(userId: Id<'user'>): Effect.Effect<SessionRecord[]>
    save(session: SessionRecord): Effect.Effect<void>
  }
>()('semu/identity-access/SessionRepository') {
  /** 프로세스 메모리에 세션을 둡니다. */
  static readonly layerMemory = (seed: ReadonlyArray<SessionRecord> = []) =>
    Layer.effect(
      SessionRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((session) => [session.id, session])))
        const all = Ref.get(store).pipe(Effect.map((sessions) => [...sessions.values()]))
        return SessionRepository.of({
          findById: (id) => Ref.get(store).pipe(Effect.map((sessions) => Option.fromNullishOr(sessions.get(id)))),
          findByOnboardingToken: (token) =>
            all.pipe(
              Effect.map((sessions) =>
                Option.fromNullishOr(sessions.find((s) => s.onboardingToken === token && s.revokedAt === undefined)),
              ),
            ),
          listActiveByUser: (userId) =>
            all.pipe(
              Effect.map((sessions) => sessions.filter((s) => s.userId === userId && s.revokedAt === undefined)),
            ),
          save: (session) => Ref.update(store, (sessions) => new Map(sessions).set(session.id, session)),
        })
      }),
    )
}
