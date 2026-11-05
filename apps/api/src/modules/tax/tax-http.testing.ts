import { Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { AppLive, TestStoreLive } from '../../app.ts'
import { AccessTokens } from '../identity-access/access-tokens.ts'
import { testActor } from '../identity-access/testing.ts'
import { taxMemoryLayer } from './tax.layer.ts'
import type { TaxMemorySeed } from './tax.layer.ts'

/** 테스트 토큰입니다. `client`는 고객 관리자, `agency`는 세무 대리인, `free`는 플랜이 없는 고객, `individual`은 개인사업자입니다. */
export const TEST_TOKENS = {
  client: testActor(),
  agency: testActor({ kind: 'AGENCY' }),
  free: testActor({ plans: new Set() }),
  individual: testActor({ businessType: 'INDIVIDUAL' }),
  viewer: testActor({ permissions: new Set(['filing:read', 'action-card:read']) }),
} as const

/** 테스트 앱에 보내는 요청입니다. */
export interface TaxTestRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  token?: keyof typeof TEST_TOKENS
  body?: unknown
  ifMatch?: string
}

/** 테스트 응답입니다. 본문을 단언하기 쉽게 `json()`을 느슨하게 둡니다. */
export interface TaxTestResponse extends Response {
  json(): Promise<any>
}

/** 테스트 앱입니다. 요청 사이에 메모리 저장소 상태가 이어집니다. */
export interface TaxTestApp {
  send(path: string, request?: TaxTestRequest): Promise<TaxTestResponse>
  dispose(): Promise<void>
}

/** 세무 저장소를 `seed`로 채운 앱 전체를 띄웁니다. 다른 컨텍스트는 `TestStoreLive`를 씁니다. */
export function taxTestApp(seed: TaxMemorySeed = {}): TaxTestApp {
  const app = HttpRouter.toWebHandler(
    AppLive.pipe(
      Layer.provide([
        TestStoreLive,
        taxMemoryLayer(seed),
        AccessTokens.layerMemory(Object.entries(TEST_TOKENS)),
        HttpServer.layerServices,
      ]),
    ),
    { disableLogger: true },
  )
  return {
    send: (path, request = {}) => {
      const headers: Record<string, string> = { authorization: `Bearer ${request.token ?? 'client'}` }
      if (request.body !== undefined) headers['content-type'] = 'application/json'
      if (request.ifMatch !== undefined) headers['if-match'] = request.ifMatch
      const init: RequestInit = { method: request.method ?? (request.body === undefined ? 'GET' : 'POST'), headers }
      if (request.body !== undefined) init.body = JSON.stringify(request.body)
      return app.handler(new Request(`http://localhost/v1${path}`, init))
    },
    dispose: () => app.dispose(),
  }
}
