import { createHash } from 'node:crypto'
import { Clock, Context, Effect, Layer, Option, Ref } from 'effect'
import type { Actor } from './actor.types.ts'

/**
 * 액세스 토큰 발급·검증입니다. 토큰은 불투명 문자열이고 행위자 하나에 대응합니다.
 *
 * 세션·로그인 흐름은 `identity-access`의 세션 서비스가 이 서비스로 토큰을 발급합니다.
 * 세션에는 토큰 원문 대신 {@link hashAccessToken}만 남기고, 폐기도 그 해시로 합니다.
 */
export class AccessTokens extends Context.Service<
  AccessTokens,
  {
    /** 토큰에 대응하는 행위자입니다. 모르거나 만료된 토큰이면 `None`입니다. */
    verify(token: string): Effect.Effect<Option.Option<Actor>>
    /** 행위자에게 새 토큰을 발급합니다. */
    issue(actor: Actor): Effect.Effect<string>
    /** {@link hashAccessToken}으로 만든 해시의 토큰을 폐기합니다. 로그아웃·비밀번호 변경·회사 전환에 씁니다. */
    revokeHash(tokenHash: string): Effect.Effect<void>
  }
>()('semu/identity-access/AccessTokens') {
  /** 토큰을 프로세스 메모리에 둡니다. `seed`는 테스트에서 미리 정한 토큰입니다. */
  static readonly layerMemory = (seed: Iterable<readonly [token: string, actor: Actor]> = []) =>
    Layer.effect(
      AccessTokens,
      Effect.gen(function* () {
        const store = yield* Ref.make(
          new Map<string, Actor>(Array.from(seed, ([token, actor]) => [hashAccessToken(token), actor] as const)),
        )
        return AccessTokens.of({
          verify: (token) =>
            Ref.get(store).pipe(Effect.map((tokens) => Option.fromNullishOr(tokens.get(hashAccessToken(token))))),
          issue: (actor) =>
            Effect.sync(() => crypto.randomUUID()).pipe(
              Effect.tap((token) => Ref.update(store, (tokens) => new Map(tokens).set(hashAccessToken(token), actor))),
            ),
          revokeHash: (tokenHash) =>
            Ref.update(store, (tokens) => {
              const next = new Map(tokens)
              next.delete(tokenHash)
              return next
            }),
        })
      }),
    )

  /**
   * 토큰을 프로세스 메모리에 두되 `ttlSeconds`가 지나면 `None`을 돌려줍니다. 세션 서비스가 발급하는 운영용 기본값입니다.
   *
   * 토큰은 서명 없는 불투명 문자열이라 폐기하면 바로 막힙니다. 여러 프로세스로 나누면 공유 저장소 구현으로 바꿉니다.
   */
  static readonly layerExpiring = (options: { ttlSeconds: number }) =>
    Layer.effect(
      AccessTokens,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map<string, { actor: Actor; expiresAt: number }>())
        return AccessTokens.of({
          verify: (token) =>
            Effect.gen(function* () {
              const entry = (yield* Ref.get(store)).get(hashAccessToken(token))
              const now = yield* Clock.currentTimeMillis
              return entry === undefined || entry.expiresAt <= now ? Option.none() : Option.some(entry.actor)
            }),
          issue: (actor) =>
            Effect.gen(function* () {
              const token = crypto.randomUUID()
              const expiresAt = (yield* Clock.currentTimeMillis) + options.ttlSeconds * 1000
              yield* Ref.update(store, (tokens) => new Map(tokens).set(hashAccessToken(token), { actor, expiresAt }))
              return token
            }),
          revokeHash: (tokenHash) =>
            Ref.update(store, (tokens) => {
              const next = new Map(tokens)
              next.delete(tokenHash)
              return next
            }),
        })
      }),
    )
}

/** access token을 저장·비교할 때 쓰는 SHA-256(16진수)입니다. 원문 토큰은 응답으로만 내보냅니다. */
export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
