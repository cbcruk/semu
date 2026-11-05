import { makeTestApp } from '../../api/src/modules/identity-access/testing-http.ts'
import type { TestApp } from '../../api/src/modules/identity-access/testing-http.ts'
import { createBff } from '../src/app.ts'
import type { Bff } from '../src/app.ts'

import { DEMO_PASSWORD } from '../../api/src/modules/identity-access/demo-seed.ts'

export { DEMO_COMPANY_IDS, DEMO_PASSWORD } from '../../api/src/modules/identity-access/demo-seed.ts'

/** 테스트 응답입니다. 본문은 단언에서 바로 꺼내 쓰도록 느슨한 타입으로 읽습니다. */
export interface LegacyResponse extends Response {
  json(): Promise<any>
}

/** 현행 클라이언트 요청 옵션입니다. */
export interface LegacyRequest {
  body?: unknown
  headers?: Record<string, string>
  /** 거짓이면 쓰기 요청에 CSRF 헤더를 붙이지 않습니다. 기본은 현행 클라이언트처럼 붙입니다. */
  csrf?: boolean
}

/**
 * 현행 브라우저 클라이언트를 흉내 냅니다. 쿠키를 저장해 다음 요청에 보내고, 쓰기 요청에는 `csrftoken` 쿠키 값을
 * `X-CSRFToken` 헤더로 보냅니다. 키는 현행 인터셉터가 바꾼 뒤의 snake_case로 씁니다.
 */
export interface LegacyClient {
  request(method: string, path: string, options?: LegacyRequest): Promise<LegacyResponse>
  login(email: string, password?: string): Promise<LegacyResponse>
  readonly cookies: ReadonlyMap<string, string>
}

/** 새 API(메모리 또는 SQLite 저장소)와 그 위의 BFF입니다. 테스트 하나가 상태를 공유합니다. */
export interface Harness {
  api: TestApp
  bff: Bff
  client(): LegacyClient
  /** BFF 시계를 앞으로 돌립니다. access token 만료를 흉내 냅니다. */
  advance(ms: number): void
  dispose(): Promise<void>
}

/**
 * 새 API를 프로세스 안 웹 핸들러로 띄우고, BFF가 그것을 업스트림으로 부르게 합니다.
 *
 * 운영에서는 같은 자리에 `fetch`가 들어갑니다. BFF가 보는 것은 HTTP 요청·응답뿐이라 둘의 차이는 전송 방식뿐입니다.
 */
export function makeHarness(): Harness {
  const api = makeTestApp()
  let offset = 0
  const bff = createBff({
    upstream: { baseUrl: 'http://api.internal', fetch: (request) => api.handler(request) },
    now: () => Date.now() + offset,
  })
  const client = (): LegacyClient => {
    const jar = new Map<string, string>()
    const request = async (method: string, path: string, options: LegacyRequest = {}): Promise<LegacyResponse> => {
      const headers = new Headers(options.headers)
      if (jar.size > 0) headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
      const csrf = jar.get('csrftoken')
      if (method !== 'GET' && options.csrf !== false && csrf !== undefined) headers.set('x-csrftoken', csrf)
      const init: RequestInit = { method, headers }
      if (options.body !== undefined) {
        headers.set('content-type', 'application/json')
        init.body = JSON.stringify(options.body)
      }
      const response = await bff.handle(new Request(`http://localhost${path}`, init))
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = '', ...attributes] = cookie.split(';')
        const index = pair.indexOf('=')
        const name = pair.slice(0, index).trim()
        const value = pair.slice(index + 1).trim()
        if (value === '' || attributes.some((attribute) => attribute.trim() === 'Max-Age=0')) jar.delete(name)
        else jar.set(name, value)
      }
      return response
    }
    const login = (email: string, password = DEMO_PASSWORD) =>
      request('POST', '/api/login/', { body: { email, password, stay_signed_in: false } })
    return { request, login, cookies: jar }
  }
  return { api, bff, client, advance: (ms) => void (offset += ms), dispose: () => api.dispose() }
}
