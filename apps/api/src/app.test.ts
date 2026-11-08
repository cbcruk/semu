import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, describe, expect, it } from 'vitest'
import { AppLive, TestStoreLive } from './app.ts'
import { AccessTokens } from './modules/identity-access/access-tokens.ts'

const Defect = HttpRouter.add('GET', '/v1/defect', Effect.die(new Error('boom')))

const app = HttpRouter.toWebHandler(
  Layer.merge(AppLive, Defect).pipe(
    Layer.provide([TestStoreLive, AccessTokens.layerMemory(), HttpServer.layerServices]),
  ),
  { disableLogger: true },
)

afterAll(() => app.dispose())

function request(path: string): Promise<Response> {
  return app.handler(new Request(`http://localhost${path}`))
}

describe('앱 계층', () => {
  it('/v1 아래에서 상태 확인에 200으로 응답합니다', async () => {
    const response = await request('/v1/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('없는 경로는 404 문제 상세(RFC 9457)로 응답합니다', async () => {
    const response = await request('/v1/missing')

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toEqual({
      type: 'urn:semu:problem:not-found',
      title: 'Resource not found',
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('결함은 원인을 드러내지 않고 500 내부 오류 문제 상세로 응답합니다', async () => {
    const response = await request('/v1/defect')

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toEqual({
      type: 'urn:semu:problem:internal',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL',
    })
  })
})
