import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { Context, Layer } from 'effect'

/** 데이터 키 길이(바이트)입니다. AES-256 키와 같습니다. */
export const DATA_KEY_BYTES = 32

/** 데이터 키를 넣는 환경 변수입니다. base64로 32바이트입니다. */
export const DATA_KEY_ENV = 'SEMU_DATA_KEY'

/** 암호문 형식의 판입니다. 형식이나 키를 바꾸면 올립니다. */
const FORMAT_VERSION = 'v1'

/**
 * 저장하는 개인정보·자격 증명을 감싸는 데이터 키입니다. 서버 전체에 하나이고, 용도마다 HKDF-SHA256으로 하위 키를 따로 만듭니다.
 *
 * 같은 키를 여러 용도에 그대로 쓰지 않으므로, 한 용도의 암호문이나 해시가 다른 용도의 키를 드러내지 않습니다.
 * 운영에서는 KMS가 이 키를 감싸 보관합니다. 지금은 환경 변수나 데이터베이스 옆 키 파일에서 읽습니다.
 */
export class DataKey extends Context.Service<
  DataKey,
  {
    /** `purpose`(예: `hr/personal-data`)에 쓸 32바이트 하위 키입니다. 같은 용도면 늘 같은 키입니다. */
    subkey(purpose: string): Uint8Array
  }
>()('semu/shared/DataKey') {
  /** 주어진 32바이트 키로 하위 키를 만듭니다. */
  static readonly layerFromKey = (key: Uint8Array) => {
    if (key.length !== DATA_KEY_BYTES) throw new Error(`data key must be ${DATA_KEY_BYTES} bytes`)
    const master = Buffer.from(key)
    return Layer.succeed(
      DataKey,
      DataKey.of({
        subkey: (purpose) => new Uint8Array(hkdfSync('sha256', master, Buffer.alloc(0), `semu:${purpose}`, 32)),
      }),
    )
  }

  /** 프로세스마다 새로 만드는 키입니다. 저장하지 않는 메모리 실행과 테스트에 씁니다. */
  static readonly layerRandom = () => DataKey.layerFromKey(randomBytes(DATA_KEY_BYTES))
}

/** base64 문자열을 32바이트 데이터 키로 읽습니다. 길이가 다르면 예외입니다. */
export function parseDataKey(base64: string): Uint8Array {
  const key = Buffer.from(base64.trim(), 'base64')
  if (key.length !== DATA_KEY_BYTES) throw new Error(`${DATA_KEY_ENV} must be base64 of ${DATA_KEY_BYTES} bytes`)
  return new Uint8Array(key)
}

/**
 * `path`의 키 파일을 읽고, 없으면 새 키를 만들어 권한 0600으로 씁니다. 키 파일을 잃으면 저장된 암호문을 열 수 없습니다.
 *
 * `created`가 참이면 이번에 만든 키입니다.
 */
export function loadOrCreateKeyFile(path: string): { key: Uint8Array; created: boolean } {
  if (existsSync(path)) return { key: parseDataKey(readFileSync(path, 'utf8')), created: false }
  const key = randomBytes(DATA_KEY_BYTES)
  writeFileSync(path, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' })
  chmodSync(path, 0o600)
  return { key: new Uint8Array(key), created: true }
}

/**
 * AES-256-GCM으로 암호화합니다. 값마다 12바이트 IV를 새로 뽑습니다.
 *
 * 결과는 `v1:<iv>:<tag>:<ciphertext>`(각각 base64url)입니다. 같은 원문도 매번 다른 암호문이 나옵니다.
 */
export function encryptString(key: Uint8Array, plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [FORMAT_VERSION, iv, cipher.getAuthTag(), ciphertext].map(encodePart).join(':')
}

/** {@link encryptString}의 결과를 엽니다. 형식이 다르거나, 키가 다르거나, 값이 바뀌었으면 예외입니다. */
export function decryptString(key: Uint8Array, token: string): string {
  const parts = token.split(':')
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) throw new Error('unsupported ciphertext format')
  const [, iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'))
  if (iv!.length !== 12 || tag!.length !== 16) throw new Error('malformed ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', key, iv!, { authTagLength: 16 })
  decipher.setAuthTag(tag!)
  return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString('utf8')
}

function encodePart(part: string | Buffer): string {
  return typeof part === 'string' ? part : part.toString('base64url')
}
