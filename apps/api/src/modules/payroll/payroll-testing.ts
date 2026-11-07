import { Clock, Effect, Layer } from 'effect'
import { httpTestApp } from '../../shared/testing/http-test-app.ts'
import type { HttpTestJson, HttpTestRequest } from '../../shared/testing/http-test-app.ts'
import type { Actor } from '../identity-access/actor.types.ts'
import { testActor } from '../identity-access/testing.ts'
import { PayrollPortFakesLive } from './payroll.layer.ts'

/** HTTP 테스트에서 쓰는 응답입니다. 본문까지 읽은 것입니다. */
export type TestResponse = HttpTestJson

/** HTTP 테스트용 앱입니다. 경로는 `/v1` 뒤부터 씁니다. */
export interface PayrollTestApp {
  request(method: string, path: string, options?: HttpTestRequest): Promise<TestResponse>
  dispose(): Promise<void>
}

/** 고객 사용자 토큰입니다. */
export const CLIENT_TOKEN = 'client-token'

/** 세무 대리인 직원 토큰입니다. */
export const AGENCY_TOKEN = 'agency-token'

/**
 * 메모리 앱에 급여 레이어를 덮어 씌운 HTTP 테스트 앱을 만듭니다. HR·Tax 포트는 급여의 가짜(`PayrollPortFakesLive`)로 바꾸고,
 * `layers`가 그 위에서 같은 서비스를 다시 대신합니다.
 *
 * 토큰은 {@link CLIENT_TOKEN}(고객), {@link AGENCY_TOKEN}(세무 대리인)과 `tokens`로 넘긴 것입니다.
 */
export function payrollTestApp(
  layers: ReadonlyArray<Layer.Layer<any, never, never>> = [],
  tokens: ReadonlyArray<readonly [string, Actor]> = [],
): PayrollTestApp {
  const app = httpTestApp({
    tokens: [[CLIENT_TOKEN, testActor()], [AGENCY_TOKEN, testActor({ kind: 'AGENCY' })], ...tokens],
    layers: [PayrollPortFakesLive, ...layers],
    basePath: '/v1',
    defaultToken: CLIENT_TOKEN,
  })
  return { request: app.json, dispose: app.dispose }
}

/**
 * `at`에서 시작해 실제 시간만큼 흐르는 시계입니다. 오늘 날짜에 따라 갈리는 규칙(추가 대장의 원천세 기한 등)을 벽시계와 떼어 놓습니다.
 * 시각이 계속 흐르므로 시각으로 만드는 ID의 순서는 실제와 같습니다. `payrollTestApp`의 `layers`에 넘깁니다.
 *
 * @example
 * ```ts
 * payrollTestApp([clockAt('2026-04-01T00:00:00+09:00')])
 * ```
 */
export function clockAt(at: string): Layer.Layer<any> {
  const start = Date.parse(at)
  const layer = Layer.effect(
    Clock.Clock,
    Effect.map(Clock.clockWith(Effect.succeed), (real): Clock.Clock => {
      const offset = start - real.currentTimeMillisUnsafe()
      const nanos = BigInt(offset) * 1_000_000n
      return {
        monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: real.monotonicTimeNanos,
        sleep: (duration) => real.sleep(duration),
        currentTimeMillisUnsafe: () => real.currentTimeMillisUnsafe() + offset,
        currentTimeMillis: Effect.sync(() => real.currentTimeMillisUnsafe() + offset),
        currentTimeNanosUnsafe: () => real.currentTimeNanosUnsafe() + nanos,
        currentTimeNanos: Effect.sync(() => real.currentTimeNanosUnsafe() + nanos),
      }
    }),
  )
  return layer as Layer.Layer<unknown> as Layer.Layer<any>
}
