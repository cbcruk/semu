import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Actor } from './actor.types.ts'

/**
 * 액세스 토큰 발급·검증입니다. 토큰은 불투명 문자열이고 행위자 하나에 대응합니다.
 *
 * 세션·로그인 흐름은 `identity-access`의 세션 서비스가 이 서비스로 토큰을 발급합니다.
 */
export class AccessTokens extends Context.Service<
  AccessTokens,
  {
    /** 토큰에 대응하는 행위자입니다. 모르거나 만료된 토큰이면 `None`입니다. */
    verify(token: string): Effect.Effect<Option.Option<Actor>>
    /** 행위자에게 새 토큰을 발급합니다. */
    issue(actor: Actor): Effect.Effect<string>
    /** 토큰을 폐기합니다. 로그아웃·비밀번호 변경·회사 전환에 씁니다. */
    revoke(token: string): Effect.Effect<void>
  }
>()('semu/identity-access/AccessTokens') {
  /** 토큰을 프로세스 메모리에 둡니다. `seed`는 테스트에서 미리 정한 토큰입니다. */
  static readonly layerMemory = (seed: Iterable<readonly [token: string, actor: Actor]> = []) =>
    Layer.effect(
      AccessTokens,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map<string, Actor>(seed))
        return AccessTokens.of({
          verify: (token) => Ref.get(store).pipe(Effect.map((tokens) => Option.fromNullishOr(tokens.get(token)))),
          issue: (actor) =>
            Effect.sync(() => crypto.randomUUID()).pipe(
              Effect.tap((token) => Ref.update(store, (tokens) => new Map(tokens).set(token, actor))),
            ),
          revoke: (token) =>
            Ref.update(store, (tokens) => {
              const next = new Map(tokens)
              next.delete(token)
              return next
            }),
        })
      }),
    )
}
