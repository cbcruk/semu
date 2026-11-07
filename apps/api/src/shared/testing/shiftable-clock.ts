import { Clock, Effect, Layer } from 'effect'

/** 24시간(ms)입니다. `Idempotency-Key` 만료 테스트에서 시계를 옮길 때 씁니다. */
export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 시각을 `offset.ms`만큼 옮길 수 있는 시계입니다. 테스트가 `offset.ms`를 바꾸면 그 뒤 요청부터 옮긴 시각을 봅니다. 잠들기는 실제 시계에
 * 맡깁니다. `Clock`은 참조라 레이어 출력 타입이 `never`여서 넓힙니다. `httpTestApp`의 `layers`에 넘깁니다.
 *
 * @example 24시간 뒤의 요청
 * ```ts
 * const clock = { ms: 0 }
 * const app = httpTestApp({ layers: [shiftableClock(clock)] })
 * clock.ms = DAY_MS + 1000
 * ```
 */
export function shiftableClock(offset: { ms: number }): Layer.Layer<any> {
  const layer = Layer.effect(
    Clock.Clock,
    Effect.map(Clock.clockWith(Effect.succeed), (real): Clock.Clock => ({
      monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: real.monotonicTimeNanos,
      sleep: (duration) => real.sleep(duration),
      currentTimeMillisUnsafe: () => real.currentTimeMillisUnsafe() + offset.ms,
      currentTimeMillis: Effect.sync(() => real.currentTimeMillisUnsafe() + offset.ms),
      currentTimeNanosUnsafe: () => real.currentTimeNanosUnsafe() + BigInt(offset.ms) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => real.currentTimeNanosUnsafe() + BigInt(offset.ms) * 1_000_000n),
    })),
  )
  return layer as Layer.Layer<unknown> as Layer.Layer<any>
}
