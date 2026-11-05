import { Effect } from 'effect'
import { HttpApiSchema } from 'effect/http-api'
import { VersionMismatch } from '../problem/problem.ts'

/**
 * `If-Match: "7"`(또는 `W/"7"`, `7`)에서 버전을 읽습니다. 헤더가 없으면 `undefined`이고 버전을 검사하지 않습니다.
 *
 * 숫자가 아니면 `NaN`을 돌려줘 어떤 버전과도 맞지 않게 합니다.
 */
export function expectedVersion(ifMatch: string | undefined): number | undefined {
  if (ifMatch === undefined) return undefined
  const version = Number(ifMatch.replace(/^W\//, '').replaceAll('"', ''))
  return Number.isInteger(version) ? version : Number.NaN
}

/**
 * 저장된 `version`이 `If-Match`로 받은 버전과 다르면 412 {@link VersionMismatch}로 실패합니다.
 *
 * @example 커맨드 서비스에서 버전 검사하기
 * ```ts
 * yield* checkVersion(filing.version, expectedVersion(headers['if-match']))
 * ```
 */
export function checkVersion(current: number, expected: number | undefined): Effect.Effect<void, VersionMismatch> {
  if (expected === undefined || expected === current) return Effect.void
  return Effect.fail(new VersionMismatch({ currentVersion: current }))
}

/** 응답 본문과 함께 다음 `If-Match`에 쓸 `ETag`를 보냅니다. 엔드포인트의 `success`는 `HttpApiSchema.WithHeaders(..., { etag })`여야 합니다. */
export function withEtag<A extends { readonly version: number }>(resource: A) {
  return HttpApiSchema.withHeaders({ body: resource, headers: { etag: `"${resource.version}"` } })
}

/**
 * 이 엔드포인트에서 나올 수 없는 오류를 타입에서 뺍니다. 그 오류가 실제로 나면 결함(defect)으로 바꿔 500이 됩니다.
 *
 * 서비스 하나가 여러 커맨드를 처리할 때, 커맨드마다 선언한 오류 목록에 맞추는 데 씁니다.
 */
export function cannotFail<const Tag extends string>(tag: Tag) {
  return <A, E extends { readonly _tag: string }, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, Exclude<E, { readonly _tag: Tag }>, R> =>
    effect.pipe(Effect.catchIf((error: E) => error._tag === tag, Effect.die)) as Effect.Effect<
      A,
      Exclude<E, { readonly _tag: Tag }>,
      R
    >
}
