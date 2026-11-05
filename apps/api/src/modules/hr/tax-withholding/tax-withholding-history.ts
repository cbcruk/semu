/**
 * `asOf`에 적용되는 이력 항목입니다. `effectiveFrom`이 `asOf` 이하인 것 중 가장 늦은 것이고, 없으면 `undefined`입니다.
 *
 * @example
 * ```ts
 * entryInEffect([{ effectiveFrom: '2026-01-01' }, { effectiveFrom: '2026-07-01' }], '2026-06-30') // 2026-01-01 항목
 * ```
 */
export function entryInEffect<E extends { effectiveFrom: string }>(
  entries: ReadonlyArray<E>,
  asOf: string,
): E | undefined {
  return entries
    .filter((entry) => entry.effectiveFrom <= asOf)
    .reduce<E | undefined>(
      (latest, entry) => (latest === undefined || entry.effectiveFrom >= latest.effectiveFrom ? entry : latest),
      undefined,
    )
}

/** `entry`를 넣습니다. 같은 `effectiveFrom` 항목은 바꾸고, 결과는 `effectiveFrom` 오름차순입니다. */
export function upsertEntry<E extends { effectiveFrom: string }>(entries: ReadonlyArray<E>, entry: E): E[] {
  return [...entries.filter((existing) => existing.effectiveFrom !== entry.effectiveFrom), entry].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0,
  )
}
