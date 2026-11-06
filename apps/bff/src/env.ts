/** Node 타이머가 받는 최대 지연(ms)입니다. 넘으면 Node가 1ms로 바꿔 제한 시간이 바로 끝납니다. */
export const MAX_TIMER_MS = 2_147_483_647

/**
 * 환경 변수 `name`을 양의 정수로 읽습니다. 없거나 비었으면 `fallback`입니다.
 *
 * 숫자가 아니거나 0 이하이거나 정수가 아니거나 `max`를 넘으면 예외입니다. 서버는 이 예외로 시작을 거부합니다.
 * `Number('')`가 0이 되거나 `Number('abc')`가 `NaN`이 되어 제한 시간·크기 제한이 조용히 꺼지는 일을 막습니다.
 * 타이머에 넣는 값(`*_MS`)은 `max`에 {@link MAX_TIMER_MS}를 줍니다.
 */
export function positiveIntegerEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  max: number = Number.MAX_SAFE_INTEGER,
): number {
  const raw = env[name]?.trim()
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  if (value > max) throw new Error(`${name} must be at most ${max}, got ${JSON.stringify(raw)}`)
  return value
}
