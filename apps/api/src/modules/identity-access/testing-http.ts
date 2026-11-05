import { Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { AppLive, MemoryLive } from '../../app.ts'
import { AccessTokens } from './access-tokens.ts'
import { DEMO_PASSWORD } from './demo-seed.ts'

/** 테스트 요청 옵션입니다. */
export interface TestRequest {
  body?: unknown
  /** `Authorization: Bearer`로 보낼 access token입니다. */
  token?: string | undefined
  /** `Cookie` 헤더 값입니다. */
  cookie?: string | undefined
  headers?: Record<string, string>
}

/** 테스트 응답입니다. 본문은 단언에서 바로 꺼내 쓰도록 느슨한 타입으로 읽습니다. */
export interface TestResponse extends Response {
  json(): Promise<any>
}

/** 메모리 저장소와 데모 시드로 띄운 앱입니다. 테스트 하나가 상태를 공유하며 여러 요청을 보냅니다. */
export interface TestApp {
  request(method: string, path: string, options?: TestRequest): Promise<TestResponse>
  /** 데모 계정으로 로그인하고 access token과 refresh 쿠키를 돌려줍니다. */
  signIn(email: string, options?: { companyId?: string; password?: string }): Promise<SignedIn>
  dispose(): Promise<void>
}

/** 로그인 결과입니다. */
export interface SignedIn {
  token: string
  /** 다음 요청의 `Cookie` 헤더에 넣을 `semu_refresh=...` 값입니다. */
  cookie: string
  body: Record<string, unknown>
}

/**
 * 앱 전체를 메모리로 띄웁니다. 로그인부터 시작하는 HTTP 테스트에 씁니다.
 *
 * @example
 * ```ts
 * const app = makeTestApp()
 * const { token } = await app.signIn('owner@alfred.example')
 * const response = await app.request('GET', '/v1/me', { token })
 * ```
 */
export function makeTestApp(): TestApp {
  const app = HttpRouter.toWebHandler(
    AppLive.pipe(Layer.provide([MemoryLive, AccessTokens.layerMemory(), HttpServer.layerServices])),
    { disableLogger: true },
  )
  const request = (method: string, path: string, options: TestRequest = {}): Promise<TestResponse> => {
    const headers: Record<string, string> = { ...options.headers }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`
    if (options.cookie !== undefined) headers['cookie'] = options.cookie
    const init: RequestInit = { method, headers }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)
    return app.handler(new Request(`http://localhost${path}`, init))
  }
  const signIn = async (email: string, options: { companyId?: string; password?: string } = {}): Promise<SignedIn> => {
    const response = await request('POST', '/v1/auth/sessions', {
      body: {
        email,
        password: options.password ?? DEMO_PASSWORD,
        ...(options.companyId === undefined ? {} : { companyId: options.companyId }),
      },
    })
    if (response.status !== 200) throw new Error(`sign-in failed: ${response.status} ${await response.text()}`)
    const body = (await response.json()) as Record<string, unknown>
    return { token: String(body['accessToken']), cookie: cookieOf(response), body }
  }
  return { request, signIn, dispose: () => app.dispose() }
}

/** 응답의 `Set-Cookie`에서 다음 요청에 보낼 `name=value`만 꺼냅니다. */
export function cookieOf(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}
