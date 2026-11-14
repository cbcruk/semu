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
import { databaseHasTables, refuseUnkeyedDatabase, verifyDataKeyFingerprint } from './shared/crypto/key-check.ts'

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
 * SQLite 파일은 데이터베이스 옆 `semu.key`(권한 0600)를 만들어 다시 씁니다. 키 파일을 잃으면 저장한 암호문을 열 수 없으므로,
 * 데이터가 이미 있는 데이터베이스 옆에서는 새 키 파일을 만들지 않고 시작을 거부합니다.
 */
function dataKey(): Uint8Array {
  const fromEnv = process.env[DATA_KEY_ENV]
  if (fromEnv !== undefined && fromEnv !== '') return parseDataKey(fromEnv)
  if (ephemeral) return new Uint8Array(randomBytes(DATA_KEY_BYTES))
  const path = join(dirname(database), 'semu.key')
  const { key, created } = loadOrCreateKeyFile(path, { create: !databaseHasTables(database) })
  console.warn(
    `${DATA_KEY_ENV} is not set; ${created ? 'created' : 'using'} the data key file ${path}. ` +
      `Back it up, or set ${DATA_KEY_ENV} in production.`,
  )
  return key
}

/**
 * 데이터 키를 정하고, 데이터베이스에 남긴 키 지문과 맞는지 봅니다. 맞지 않으면 이유를 남기고 끝냅니다.
 *
 * 키 지문 없이 데이터가 있는 데이터베이스(데이터 암호화 이전에 만든 것)는 키를 고르기 전에 거부합니다. 지우고 다시 만들어야 합니다.
 */
function startupKey(): Uint8Array {
  try {
    if (!ephemeral) refuseUnkeyedDatabase(database)
    const key = dataKey()
    // 다른 키로 띄우면 저장된 암호문을 열 때마다 500이 나므로, 데이터베이스에 남긴 키 지문이 다르면 시작하지 않습니다.
    if (!ephemeral) verifyDataKeyFingerprint(database, key)
    return key
  } catch (error) {
    console.error(`Refusing to start: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

const key = startupKey()

/** 정기 작업 실행기입니다. `SEMU_SCHEDULER=off`면 띄우지 않습니다(같은 데이터베이스로 프로세스를 여럿 띄울 때 하나만 켜도 됨). */
const runtime = { scheduler: process.env['SEMU_SCHEDULER'] !== 'off' }

HttpRouter.serve(AppLive).pipe(
  Layer.provide([
    database === 'memory' ? EncryptedMemoryLive(key, runtime) : SqliteLive(database, key, runtime),
    AccessTokens.layerExpiring({ ttlSeconds: ACCESS_TOKEN_TTL_SECONDS }),
    NodeHttpServer.layer(createServer, { port }),
  ]),
  Layer.launch,
  NodeRuntime.runMain,
)
