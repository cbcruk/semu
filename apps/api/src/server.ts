import { createServer } from 'node:http'
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { AppLive, MemoryLive } from './app.ts'
import { AccessTokens } from './modules/identity-access/access-tokens.ts'
import { ACCESS_TOKEN_TTL_SECONDS } from './modules/identity-access/sessions/sessions.ts'

const port = Number(process.env['PORT'] ?? 3000)

HttpRouter.serve(AppLive).pipe(
  Layer.provide([
    MemoryLive,
    AccessTokens.layerExpiring({ ttlSeconds: ACCESS_TOKEN_TTL_SECONDS }),
    NodeHttpServer.layer(createServer, { port }),
  ]),
  Layer.launch,
  NodeRuntime.runMain,
)
