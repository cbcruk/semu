import { httpTestApp } from '../../../shared/testing/http-test-app.ts'
import type { HttpTestRequest, HttpTestResponse } from '../../../shared/testing/http-test-app.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { testActor } from '../../identity-access/testing.ts'
import { BookkeepingPortFakesLive } from '../bookkeeping.layer.ts'

/** 테스트 앱에 보내는 요청 옵션입니다. 토큰 기본값은 `admin`입니다. */
export type SendOptions = HttpTestRequest

/** 테스트용 앱입니다. 요청마다 같은 메모리 저장소를 쓰고, 경로는 `/v1`까지 씁니다. */
export interface TestApp {
  send(method: string, path: string, options?: SendOptions): Promise<HttpTestResponse>
  dispose(): Promise<void>
}

/**
 * 데모 데이터가 든 메모리 앱을 만듭니다. 다른 컨텍스트 포트는 Bookkeeping의 가짜(`BookkeepingPortFakesLive`)로 바꿉니다. `admin` 토큰은 모든 권한의 데모 회사 행위자이고, `tokens`로 다른 행위자를 더합니다.
 *
 * @example 권한이 좁은 행위자
 * ```ts
 * const app = testApp({ reader: testActor({ permissions: new Set(['evidence:read']) }) })
 * await app.send('POST', '/v1/evidence::batchClassify', { token: 'reader', body })
 * ```
 */
export function testApp(tokens: Record<string, Actor> = {}): TestApp {
  const app = httpTestApp({
    tokens: Object.entries({ admin: testActor(), ...tokens }),
    layers: [BookkeepingPortFakesLive],
    defaultToken: 'admin',
  })
  return { send: app.request, dispose: app.dispose }
}
