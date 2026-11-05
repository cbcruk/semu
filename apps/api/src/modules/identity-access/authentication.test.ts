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
    authorize({ permission: 'probe:read' }).pipe(
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

describe('Authentication', () => {
  it('provides the actor of a known token', async () => {
    const response = await get('admin')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ companyId: testActor().companyId })
  })

  it.each([undefined, 'unknown'])('answers 401 for token %s', async (token) => {
    const response = await get(token)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('answers 403 when the actor lacks the permission', async () => {
    const response = await get('viewer')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'probe:read' })
  })
})
