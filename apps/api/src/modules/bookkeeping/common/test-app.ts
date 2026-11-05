import { Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { AppLive, MemoryLive } from '../../../app.ts'
import { AccessTokens } from '../../identity-access/access-tokens.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { testActor } from '../../identity-access/testing.ts'

/** 테스트 앱에 보내는 요청 옵션입니다. */
export interface SendOptions {
  body?: unknown
  headers?: Record<string, string>
  /** 기본 토큰(`admin`) 대신 쓸 토큰입니다. */
  token?: string
}

/** 테스트용 앱입니다. 요청마다 같은 메모리 저장소를 씁니다. */
export interface TestApp {
  send(method: string, path: string, options?: SendOptions): Promise<Response>
  dispose(): Promise<void>
}

/**
 * 데모 데이터가 든 메모리 앱을 만듭니다. `admin` 토큰은 모든 권한의 데모 회사 행위자이고, `tokens`로 다른 행위자를 더합니다.
 *
 * @example 권한이 좁은 행위자
 * ```ts
 * const app = testApp({ reader: testActor({ permissions: new Set(['evidence:read']) }) })
 * await app.send('POST', '/v1/evidence::batchClassify', { token: 'reader', body })
 * ```
 */
export function testApp(tokens: Record<string, Actor> = {}): TestApp {
  const app = HttpRouter.toWebHandler(
    AppLive.pipe(
      Layer.provide([
        MemoryLive,
        AccessTokens.layerMemory(Object.entries({ admin: testActor(), ...tokens })),
        HttpServer.layerServices,
      ]),
    ),
    { disableLogger: true },
  )
  return {
    send: (method, path, options = {}) => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${options.token ?? 'admin'}`,
        ...options.headers,
      }
      const init: RequestInit = { method, headers }
      if (options.body !== undefined) {
        headers['content-type'] = 'application/json'
        init.body = JSON.stringify(options.body)
      }
      return app.handler(new Request(`http://localhost${path}`, init))
    },
    dispose: () => app.dispose(),
  }
}
