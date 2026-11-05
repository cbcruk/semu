import { Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { AppLive, TestStoreLive } from '../../app.ts'
import { AccessTokens } from '../../modules/identity-access/access-tokens.ts'
import type { Actor } from '../../modules/identity-access/actor.types.ts'

/** {@link httpTestApp}의 설정입니다. */
export interface HttpTestAppOptions {
  /** 메모리 토큰 표입니다. 없으면 빈 표로 시작합니다. */
  tokens?: Iterable<readonly [token: string, actor: Actor]>
  /** `TestStoreLive` 위에 덮어 씌울 레이어입니다. 뒤의 것이 앞의 것과 같은 서비스를 대신합니다. */
  layers?: ReadonlyArray<Layer.Layer<any, never, never>>
  /** 요청 경로 앞에 붙일 접두사입니다. 예: `/v1`. 기본값은 빈 문자열입니다. */
  basePath?: string
  /** `token`을 주지 않은 요청이 쓸 토큰입니다. 없으면 `Authorization` 헤더를 보내지 않습니다. */
  defaultToken?: string
}

/** 테스트 요청 옵션입니다. */
export interface HttpTestRequest {
  /** JSON으로 보낼 본문입니다. 있으면 `content-type: application/json`을 붙입니다. */
  body?: unknown
  /** `Authorization: Bearer`로 보낼 access token입니다. */
  token?: string | undefined
  /** `Cookie` 헤더 값입니다. */
  cookie?: string | undefined
  /** `If-Match` 헤더 값입니다. 예: `"3"` */
  ifMatch?: string | undefined
  /** `Idempotency-Key` 헤더 값입니다. */
  idempotencyKey?: string | undefined
  /** 그 밖의 헤더입니다. `token`이 만든 `Authorization`은 덮어쓰고, 위 옵션이 만든 헤더에는 덮어써집니다. */
  headers?: Record<string, string>
}

/** 테스트 응답입니다. 본문은 단언에서 바로 꺼내 쓰도록 느슨한 타입으로 읽습니다. */
export interface HttpTestResponse extends Response {
  json(): Promise<any>
}

/** 본문까지 읽은 테스트 응답입니다. 빈 본문은 `undefined`입니다. */
export interface HttpTestJson {
  status: number
  headers: Headers
  body: any
}

/** 같은 저장소를 공유하며 여러 요청을 보내는 테스트 앱입니다. */
export interface HttpTestApp {
  request(method: string, path: string, options?: HttpTestRequest): Promise<HttpTestResponse>
  /** 요청을 보내고 상태·헤더·JSON 본문을 함께 돌려줍니다. */
  json(method: string, path: string, options?: HttpTestRequest): Promise<HttpTestJson>
  dispose(): Promise<void>
}

/**
 * 앱 전체(`AppLive`)를 `TestStoreLive`(메모리, `SEMU_TEST_STORE=sqlite`이면 SQLite)로 띄웁니다. 컨텍스트별 HTTP 테스트 도우미는
 * 이것 위에 토큰 표와 레이어만 바꿔 얹습니다.
 *
 * @example
 * ```ts
 * const app = httpTestApp({ tokens: [['admin', testActor()]], basePath: '/v1', defaultToken: 'admin' })
 * const { status, body } = await app.json('PATCH', '/employees/emp_1', { body: patch, ifMatch: '"1"' })
 * ```
 */
export function httpTestApp(options: HttpTestAppOptions = {}): HttpTestApp {
  const basePath = options.basePath ?? ''
  const app = HttpRouter.toWebHandler(
    AppLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          TestStoreLive,
          ...(options.layers ?? []),
          AccessTokens.layerMemory(options.tokens),
          HttpServer.layerServices,
        ),
      ),
    ),
    { disableLogger: true },
  )
  const request = (method: string, path: string, init: HttpTestRequest = {}): Promise<HttpTestResponse> => {
    const token = init.token ?? options.defaultToken
    const headers: Record<string, string> = {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...init.headers,
    }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.ifMatch !== undefined) headers['if-match'] = init.ifMatch
    if (init.idempotencyKey !== undefined) headers['idempotency-key'] = init.idempotencyKey
    if (init.cookie !== undefined) headers['cookie'] = init.cookie
    const requestInit: RequestInit = { method, headers }
    if (init.body !== undefined) requestInit.body = JSON.stringify(init.body)
    return app.handler(new Request(`http://localhost${basePath}${path}`, requestInit))
  }
  return {
    request,
    json: async (method, path, init) => {
      const response = await request(method, path, init)
      const text = await response.text()
      return { status: response.status, headers: response.headers, body: text === '' ? undefined : JSON.parse(text) }
    },
    dispose: () => app.dispose(),
  }
}
