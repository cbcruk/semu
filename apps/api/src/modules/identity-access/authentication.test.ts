import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { afterAll, describe, expect, it } from 'vitest'
import { PermissionDenied } from '../../shared/problem/problem.ts'
import { AccessTokens } from './access-tokens.ts'
import { Authentication, AuthenticationLive } from './authentication.ts'
import { authorize } from './authorization.ts'
import { testActor } from './testing.ts'

class ProbeGroup extends HttpApiGroup.make('probe')
  .add(
    HttpApiEndpoint.get('read', '/probe', {
      success: Schema.Struct({ companyId: Schema.String }),
      error: PermissionDenied,
    }),
  )
  .middleware(Authentication) {}

class ProbeApi extends HttpApi.make('probe').add(ProbeGroup) {}

const ProbeLive = HttpApiBuilder.group(ProbeApi, 'probe', (handlers) =>
  handlers.handle('read', () =>
    authorize({ permission: 'company:update' }).pipe(
      Effect.map((actor) => ({ companyId: actor.companyId })),
      Effect.catchTag(['EntitlementRequired', 'TermsReagreementRequired'], Effect.die),
    ),
  ),
)

const app = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(ProbeApi).pipe(
    Layer.provide(ProbeLive),
    Layer.provide(AuthenticationLive),
    Layer.provide([
      AccessTokens.layerMemory([
        ['admin', testActor()],
        ['viewer', testActor({ permissions: new Set(['employee:read']) })],
      ]),
      HttpServer.layerServices,
    ]),
  ),
  { disableLogger: true },
)

afterAll(() => app.dispose())

function get(token?: string): Promise<Response> {
  const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` }
  return app.handler(new Request('http://localhost/probe', { headers }))
}

describe('인증', () => {
  it('알려진 토큰이면 그 토큰의 행위자를 줍니다', async () => {
    const response = await get('admin')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ companyId: testActor().companyId })
  })

  it.each([undefined, 'unknown'])('토큰이 %s이면 401로 답합니다', async (token) => {
    const response = await get(token)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('행위자에게 권한이 없으면 403으로 답합니다', async () => {
    const response = await get('viewer')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'company:update' })
  })
})
