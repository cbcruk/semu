import { Clock, Effect, Layer } from 'effect'

/** 24시간(ms)입니다. `Idempotency-Key` 만료 테스트에서 시계를 옮길 때 씁니다. */
export const DAY_MS = 24 * 60 * 60 * 1000

/** {@link shiftableClock}의 기본 시작 시각입니다. */
export const SHIFTABLE_CLOCK_START = '2026-11-07T00:00:00.000Z'

/**
 * 벽시계와 떨어진 결정적인 시계입니다. 시각은 `start + offset.ms`이고, 읽을 때마다 1ms씩만 흐릅니다(시각으로 만드는 ID의 순서를 지키기
 * 위해서입니다). 그래서 느린 CI에서도 `offset.ms = DAY_MS - 1000` 같은 경계가 흔들리지 않습니다. 테스트가 `offset.ms`를 바꾸면 그 뒤
 * 요청부터 옮긴 시각을 봅니다. 잠들기는 실제 시계에 맡깁니다. `Clock`은 참조라 레이어 출력 타입이 `never`여서 넓힙니다.
 * `httpTestApp`의 `layers`에 넘깁니다.
 *
 * @example 24시간 뒤의 요청
 * ```ts
 * const clock = { ms: 0 }
 * const app = httpTestApp({ layers: [shiftableClock(clock)] })
 * clock.ms = DAY_MS + 1000
 * ```
 */
export function shiftableClock(offset: { ms: number }, start: string = SHIFTABLE_CLOCK_START): Layer.Layer<any> {
  const base = Date.parse(start)
  let ticks = 0
  const now = () => base + offset.ms + ticks++
  const layer = Layer.effect(
    Clock.Clock,
    Effect.map(Clock.clockWith(Effect.succeed), (real): Clock.Clock => ({
      monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: real.monotonicTimeNanos,
      sleep: (duration) => real.sleep(duration),
      currentTimeMillisUnsafe: now,
      currentTimeMillis: Effect.sync(now),
      currentTimeNanosUnsafe: () => BigInt(now()) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
    })),
  )
  return layer as Layer.Layer<unknown> as Layer.Layer<any>
}
