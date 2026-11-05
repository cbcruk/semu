import { Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { AppLive, TestStoreLive } from '../../../app.ts'
import { AccessTokens } from '../../identity-access/access-tokens.ts'
import { testActor } from '../../identity-access/testing.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** HR HTTP 테스트 전용 회사입니다. 데모 시드가 없어 테스트가 빈 회사에서 시작합니다. */
export const HR_TEST_COMPANY_ID = 'cmp_01JBQ0000000000000000HRTST' as Id<'company'>

/** 테스트 요청 옵션입니다. */
export interface TestRequest {
  body?: unknown
  ifMatch?: string
  /** 기본값은 모든 권한을 가진 `admin`입니다. */
  token?: string
  headers?: Record<string, string>
}

/** 같은 메모리 저장소를 공유하는 테스트 앱입니다. */
export interface TestApp {
  request(method: string, path: string, options?: TestRequest): Promise<Response>
  /** 요청을 보내고 JSON 본문과 상태를 함께 돌려줍니다. */
  json(method: string, path: string, options?: TestRequest): Promise<{ status: number; body: any }>
  dispose(): Promise<void>
}

/**
 * 메모리 저장소로 앱을 띄웁니다. 토큰은 `admin`(모든 권한), `viewer`(읽기 권한만), `no-plan`(플랜 없음)입니다.
 *
 * 행위자는 {@link HR_TEST_COMPANY_ID}에 속합니다.
 */
export function startTestApp(): TestApp {
  const companyId = HR_TEST_COMPANY_ID
  const tokens = AccessTokens.layerMemory([
    ['admin', testActor({ companyId })],
    [
      'viewer',
      testActor({ companyId, permissions: new Set(['employee:read', 'organization:read', 'esign-request:read']) }),
    ],
    ['no-plan', testActor({ companyId, plans: new Set() })],
  ])
  const app = HttpRouter.toWebHandler(AppLive.pipe(Layer.provide([TestStoreLive, tokens, HttpServer.layerServices])), {
    disableLogger: true,
  })

  const request = (method: string, path: string, options: TestRequest = {}): Promise<Response> => {
    const headers: Record<string, string> = { authorization: `Bearer ${options.token ?? 'admin'}`, ...options.headers }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (options.ifMatch !== undefined) headers['if-match'] = options.ifMatch
    const init: RequestInit = { method, headers }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)
    return app.handler(new Request(`http://localhost/v1${path}`, init))
  }

  return {
    request,
    json: async (method, path, options) => {
      const response = await request(method, path, options)
      const text = await response.text()
      return { status: response.status, body: text === '' ? undefined : JSON.parse(text) }
    },
    dispose: () => app.dispose(),
  }
}
