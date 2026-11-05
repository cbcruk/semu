import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { AppLive, EncryptedMemoryLive, SqliteLive } from './app.ts'
import { AccessTokens } from './modules/identity-access/access-tokens.ts'
import { ACCESS_TOKEN_TTL_SECONDS } from './modules/identity-access/sessions/sessions.ts'
import { DATA_KEY_BYTES, DATA_KEY_ENV, loadOrCreateKeyFile, parseDataKey } from './shared/crypto/data-key.ts'

const port = Number(process.env['PORT'] ?? 3000)
/** SQLite 파일 경로입니다. `memory`면 저장하지 않고 프로세스 메모리에만 둡니다. */
const database = process.env['SEMU_DATABASE'] ?? 'data/semu.sqlite'
/** 프로세스가 끝나면 사라지는 저장소입니다. */
const ephemeral = database === 'memory' || database === ':memory:'
if (!ephemeral) mkdirSync(dirname(database), { recursive: true })

/**
 * 개인정보·자격 증명 암호화에 쓰는 데이터 키입니다.
 *
 * `SEMU_DATA_KEY`(base64 32바이트)가 있으면 그 값을 씁니다. 없으면 메모리 실행은 프로세스마다 새 키를 뽑고,
 * SQLite 파일은 데이터베이스 옆 `semu.key`(권한 0600)를 만들어 다시 씁니다. 키 파일을 잃으면 저장한 암호문을 열 수 없습니다.
 */
function dataKey(): Uint8Array {
  const fromEnv = process.env[DATA_KEY_ENV]
  if (fromEnv !== undefined && fromEnv !== '') return parseDataKey(fromEnv)
  if (ephemeral) return new Uint8Array(randomBytes(DATA_KEY_BYTES))
  const path = join(dirname(database), 'semu.key')
  const { key, created } = loadOrCreateKeyFile(path)
  console.warn(
    `${DATA_KEY_ENV} is not set; ${created ? 'created' : 'using'} the data key file ${path}. ` +
      `Back it up, or set ${DATA_KEY_ENV} in production.`,
  )
  return key
}

const key = dataKey()

HttpRouter.serve(AppLive).pipe(
  Layer.provide([
    database === 'memory' ? EncryptedMemoryLive(key) : SqliteLive(database, key),
    AccessTokens.layerExpiring({ ttlSeconds: ACCESS_TOKEN_TTL_SECONDS }),
    NodeHttpServer.layer(createServer, { port }),
  ]),
  Layer.launch,
  NodeRuntime.runMain,
)
