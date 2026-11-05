import { Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { AppLive, TestStoreLive } from '../../app.ts'
import { AccessTokens } from '../identity-access/access-tokens.ts'
import type { Actor } from '../identity-access/actor.types.ts'
import { testActor } from '../identity-access/testing.ts'
import { PayrollPortFakesLive } from './payroll.layer.ts'

/** HTTP 테스트에서 쓰는 응답입니다. */
export interface TestResponse {
  status: number
  headers: Headers
  body: any
}

/** HTTP 테스트용 앱입니다. */
export interface PayrollTestApp {
  request(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<TestResponse>
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
  const app = HttpRouter.toWebHandler(
    AppLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          TestStoreLive,
          PayrollPortFakesLive,
          ...layers,
          AccessTokens.layerMemory([
            [CLIENT_TOKEN, testActor()],
            [AGENCY_TOKEN, testActor({ kind: 'AGENCY' })],
            ...tokens,
          ]),
          HttpServer.layerServices,
        ),
      ),
    ),
    { disableLogger: true },
  )
  return {
    async request(method, path, options = {}) {
      const headers: Record<string, string> = { ...options.headers }
      headers.authorization = `Bearer ${options.token ?? CLIENT_TOKEN}`
      if (options.body !== undefined) headers['content-type'] = 'application/json'
      const response = await app.handler(
        new Request(`http://localhost/v1${path}`, {
          method,
          headers,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        }),
      )
      const text = await response.text()
      return { status: response.status, headers: response.headers, body: text === '' ? undefined : JSON.parse(text) }
    },
    dispose: () => app.dispose(),
  }
}
