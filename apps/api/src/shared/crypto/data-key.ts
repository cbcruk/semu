import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { linkSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { Context, Layer } from 'effect'

/** 데이터 키 길이(바이트)입니다. AES-256 키와 같습니다. */
export const DATA_KEY_BYTES = 32

/** 데이터 키를 넣는 환경 변수입니다. base64로 32바이트입니다. */
export const DATA_KEY_ENV = 'SEMU_DATA_KEY'

/** 암호문 형식의 판입니다. 형식이나 키를 바꾸면 올립니다. `v2`부터 용도 문자열을 AAD로 묶습니다. */
const FORMAT_VERSION = 'v2'

/** base64로 쓴 32바이트 키입니다. 패딩까지 정확히 맞아야 합니다. */
const DATA_KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/

/** 복호화하지 못했습니다. 형식이 틀렸거나, 키가 다르거나, 값·용도가 바뀌었습니다. 메시지에 원문·키는 넣지 않습니다. */
export class DecryptionFailed extends Error {
  override readonly name = 'DecryptionFailed'
  readonly purpose: string
  readonly reason: 'FORMAT' | 'AUTHENTICATION'
  constructor(purpose: string, reason: 'FORMAT' | 'AUTHENTICATION') {
    super(`decryption failed (purpose=${purpose}, reason=${reason}); check that the data key matches the database`)
    this.purpose = purpose
    this.reason = reason
  }
}

/** 마스터 키에서 `purpose`용 32바이트 하위 키를 만듭니다(HKDF-SHA256, info `semu:<purpose>`). */
export function deriveSubkey(master: Uint8Array, purpose: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', master, Buffer.alloc(0), `semu:${purpose}`, 32))
}

/** 키를 드러내지 않고 같은 키인지 확인하는 지문입니다. 데이터베이스에 남겨 기동할 때 비교합니다. */
export function dataKeyFingerprint(key: Uint8Array): string {
  return createHmac('sha256', deriveSubkey(key, 'data-key/fingerprint')).update('semu-data-key-check').digest('hex')
}

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
    const master = new Uint8Array(key)
    return Layer.succeed(DataKey, DataKey.of({ subkey: (purpose) => deriveSubkey(master, purpose) }))
  }

  /** 프로세스마다 새로 만드는 키입니다. 저장하지 않는 메모리 실행과 테스트에 씁니다. */
  static readonly layerRandom = () => DataKey.layerFromKey(randomBytes(DATA_KEY_BYTES))
}

/** base64 문자열을 32바이트 데이터 키로 읽습니다. base64가 아닌 문자가 있거나 길이가 다르면 예외입니다. */
export function parseDataKey(base64: string): Uint8Array {
  const trimmed = base64.trim()
  if (!DATA_KEY_BASE64.test(trimmed)) throw new Error(`${DATA_KEY_ENV} must be base64 of ${DATA_KEY_BYTES} bytes`)
  return new Uint8Array(Buffer.from(trimmed, 'base64'))
}

/** 키 파일 읽기·만들기 옵션입니다. */
export interface KeyFileOptions {
  /** 거짓이면 파일이 없을 때 만들지 않고 예외입니다. 이미 데이터가 있는 데이터베이스 옆에서 씁니다. */
  create: boolean
}

/**
 * `path`의 키 파일을 읽고, 없으면(그리고 `create`면) 새 키를 만들어 권한 0600으로 씁니다. 키 파일을 잃으면 저장된 암호문을 열 수 없습니다.
 *
 * - 새 키는 임시 파일에 쓴 뒤 `link`로 한 번에 게시합니다. 다른 프로세스가 먼저 만들었으면(`EEXIST`) 그 파일을 읽습니다
 * - 그룹·다른 사용자가 읽을 수 있는 키 파일(권한 0600보다 넓음)은 거부합니다
 *
 * `created`가 참이면 이번에 만든 키입니다.
 */
export function loadOrCreateKeyFile(
  path: string,
  options: KeyFileOptions = { create: true },
): { key: Uint8Array; created: boolean } {
  const existing = readKeyFile(path)
  if (existing !== undefined) return { key: existing, created: false }
  if (!options.create) {
    throw new Error(
      `data key file ${path} is missing but the database already has data. ` +
        `Restore the key file or set ${DATA_KEY_ENV}; a new key could not decrypt the stored data.`,
    )
  }
  const key = randomBytes(DATA_KEY_BYTES)
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temporary, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' })
  try {
    linkSync(temporary, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return { key: readKeyFile(path)!, created: false }
  } finally {
    unlinkSync(temporary)
  }
  return { key: new Uint8Array(key), created: true }
}

/** 키 파일을 읽습니다. 없으면 `undefined`이고, 권한이 0600보다 넓으면 예외입니다. */
function readKeyFile(path: string): Uint8Array | undefined {
  let mode: number
  try {
    mode = statSync(path).mode
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if ((mode & 0o077) !== 0) {
    throw new Error(`data key file ${path} is readable by group or others; run chmod 600 ${path}`)
  }
  return parseDataKey(readFileSync(path, 'utf8'))
}

/**
 * AES-256-GCM으로 암호화합니다. 값마다 12바이트 IV를 새로 뽑고, `purpose`(예: `hr/registration-number`)를 AAD로 묶습니다.
 *
 * 결과는 `v2:<iv>:<tag>:<ciphertext>`(각각 base64url)입니다. 같은 원문도 매번 다른 암호문이 나오고,
 * 다른 용도(필드)로 옮긴 암호문은 복호화에서 거절됩니다.
 */
export function encryptString(key: Uint8Array, purpose: string, plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(purpose, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [FORMAT_VERSION, iv, cipher.getAuthTag(), ciphertext].map(encodePart).join(':')
}

/**
 * {@link encryptString}의 결과를 엽니다. 형식이 다르거나, 키·용도가 다르거나, 값이 바뀌었으면 {@link DecryptionFailed}입니다.
 */
export function decryptString(key: Uint8Array, purpose: string, token: string): string {
  const parts = token.split(':')
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) throw new DecryptionFailed(purpose, 'FORMAT')
  const [, iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'))
  if (iv!.length !== 12 || tag!.length !== 16) throw new DecryptionFailed(purpose, 'FORMAT')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv!, { authTagLength: 16 })
    decipher.setAAD(Buffer.from(purpose, 'utf8'))
    decipher.setAuthTag(tag!)
    return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString('utf8')
  } catch {
    throw new DecryptionFailed(purpose, 'AUTHENTICATION')
  }
}

function encodePart(part: string | Buffer): string {
  return typeof part === 'string' ? part : part.toString('base64url')
}
