import { Clock, Context, Effect, Layer, Option, Ref } from 'effect'
import type { Actor, AgencyPrincipal } from './actor.types.ts'

/**
 * 토큰 하나가 가리키는 주체입니다. 회사 범위 토큰은 {@link Actor}, 대리인 범위 토큰은 {@link AgencyPrincipal}입니다.
 *
 * 둘은 `scope: 'AGENCY'`로 구분합니다. `Actor`에는 `scope`가 없습니다.
 */
export type TokenSubject = Actor | AgencyPrincipal

/** 대리인 범위 토큰의 주체인지입니다. */
export function isAgencyPrincipal(subject: TokenSubject): subject is AgencyPrincipal {
  return 'scope' in subject && subject.scope === 'AGENCY'
}

/**
 * 액세스 토큰 발급·검증입니다. 토큰은 불투명 문자열이고 주체 하나에 대응합니다.
 *
 * 세션·로그인 흐름은 `identity-access`의 세션 서비스가 이 서비스로 토큰을 발급합니다.
 * 회사 범위와 대리인 범위 토큰은 같은 저장소를 쓰고, 검증하는 쪽이 범위를 골라 읽습니다.
 */
export class AccessTokens extends Context.Service<
  AccessTokens,
  {
    /** 회사 범위 토큰의 행위자입니다. 모르거나 만료됐거나 대리인 범위 토큰이면 `None`입니다. */
    verify(token: string): Effect.Effect<Option.Option<Actor>>
    /** 대리인 범위 토큰의 주체입니다. 모르거나 만료됐거나 회사 범위 토큰이면 `None`입니다. */
    verifyAgency(token: string): Effect.Effect<Option.Option<AgencyPrincipal>>
    /** 행위자에게 회사 범위 토큰을 발급합니다. */
    issue(actor: Actor): Effect.Effect<string>
    /** 대리인에게 대리인 범위 토큰을 발급합니다. */
    issueAgency(principal: AgencyPrincipal): Effect.Effect<string>
    /** 토큰을 폐기합니다. 로그아웃·비밀번호 변경·회사 전환에 씁니다. */
    revoke(token: string): Effect.Effect<void>
  }
>()('semu/identity-access/AccessTokens') {
  /** 토큰을 프로세스 메모리에 둡니다. `seed`는 테스트에서 미리 정한 토큰입니다. */
  static readonly layerMemory = (seed: Iterable<readonly [token: string, subject: TokenSubject]> = []) =>
    Layer.effect(
      AccessTokens,
      makeTokenStore(
        [...seed].map(([token, subject]) => [token, { subject, expiresAt: Number.POSITIVE_INFINITY }] as const),
        undefined,
      ),
    )

  /**
   * 토큰을 프로세스 메모리에 두되 `ttlSeconds`가 지나면 `None`을 돌려줍니다. 세션 서비스가 발급하는 운영용 기본값입니다.
   *
   * 토큰은 서명 없는 불투명 문자열이라 폐기하면 바로 막힙니다. 여러 프로세스로 나누면 공유 저장소 구현으로 바꿉니다.
   * 회사 범위와 대리인 범위가 같은 수명입니다.
   */
  static readonly layerExpiring = (options: { ttlSeconds: number }) =>
    Layer.effect(AccessTokens, makeTokenStore([], options.ttlSeconds))
}

interface TokenEntry {
  subject: TokenSubject
  expiresAt: number
}

function makeTokenStore(
  seed: ReadonlyArray<readonly [string, TokenEntry]>,
  ttlSeconds: number | undefined,
): Effect.Effect<AccessTokens['Service']> {
  return Effect.gen(function* () {
    const store = yield* Ref.make(new Map<string, TokenEntry>(seed))

    const lookup = (token: string) =>
      Effect.gen(function* () {
        const entry = (yield* Ref.get(store)).get(token)
        const now = yield* Clock.currentTimeMillis
        return entry === undefined || entry.expiresAt <= now ? Option.none<TokenSubject>() : Option.some(entry.subject)
      })

    const put = (subject: TokenSubject) =>
      Effect.gen(function* () {
        const token = crypto.randomUUID()
        const expiresAt =
          ttlSeconds === undefined ? Number.POSITIVE_INFINITY : (yield* Clock.currentTimeMillis) + ttlSeconds * 1000
        yield* Ref.update(store, (tokens) => new Map(tokens).set(token, { subject, expiresAt }))
        return token
      })

    return AccessTokens.of({
      verify: (token) =>
        Effect.map(
          lookup(token),
          Option.flatMap((subject) => (isAgencyPrincipal(subject) ? Option.none() : Option.some(subject))),
        ),
      verifyAgency: (token) =>
        Effect.map(
          lookup(token),
          Option.flatMap((subject) => (isAgencyPrincipal(subject) ? Option.some(subject) : Option.none())),
        ),
      issue: put,
      issueAgency: put,
      revoke: (token) =>
        Ref.update(store, (tokens) => {
          const next = new Map(tokens)
          next.delete(token)
          return next
        }),
    })
  })
}
