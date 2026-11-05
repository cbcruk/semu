import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { AppLive, MemoryLive, SqliteLive } from './app.ts'
import { AccessTokens } from './modules/identity-access/access-tokens.ts'
import { ACCESS_TOKEN_TTL_SECONDS } from './modules/identity-access/sessions/sessions.ts'

const port = Number(process.env['PORT'] ?? 3000)
/** SQLite 파일 경로입니다. `memory`면 저장하지 않고 프로세스 메모리에만 둡니다. */
const database = process.env['SEMU_DATABASE'] ?? 'data/semu.sqlite'
if (database !== 'memory' && database !== ':memory:') mkdirSync(dirname(database), { recursive: true })

HttpRouter.serve(AppLive).pipe(
  Layer.provide([
    database === 'memory' ? MemoryLive : SqliteLive(database),
    AccessTokens.layerExpiring({ ttlSeconds: ACCESS_TOKEN_TTL_SECONDS }),
    NodeHttpServer.layer(createServer, { port }),
  ]),
  Layer.launch,
  NodeRuntime.runMain,
)
