import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { DataKey } from '../../../shared/crypto/data-key.ts'

/** 봉투 암호화한 자격 증명입니다. 원문(ID/PW, PG 비밀 키, 인증서 개인키·서명 비밀번호)은 이 형태로만 저장합니다. */
export interface SealedSecret {
  keyVersion: number
  iv: string
  tag: string
  ciphertext: string
}

/** 자격 증명 원문입니다. 키 이름과 값의 쌍이고, 수집 워커 경계 안에서만 엽니다. */
export type SecretFields = Readonly<Record<string, string>>

/** 테스트용 고정 키입니다. 서버는 쓰지 않고 {@link CredentialVault.layerDataKey}로 {@link DataKey}의 하위 키를 씁니다. */
export const DEMO_VAULT_KEY: Uint8Array = createHash('sha256').update('semu-demo-credential-vault').digest()

/** `key`로 AES-256-GCM 암호화합니다. 값마다 IV를 새로 뽑습니다. */
export function sealSecret(key: Uint8Array, fields: SecretFields, keyVersion = 1): SealedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(fields), 'utf8'), cipher.final()])
  return {
    keyVersion,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

/** {@link sealSecret}로 만든 값을 엽니다. 키가 다르거나 값이 바뀌었으면 예외입니다. */
export function openSecret(key: Uint8Array, sealed: SealedSecret): SecretFields {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'), { authTagLength: 16 })
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  const plain = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as SecretFields
}

/**
 * 자격 증명 금고입니다. 저장소에는 봉한 값만 들어가고, 응답·로그·감사 기록에는 원문을 넣지 않습니다.
 *
 * 키를 바꿀 때를 위해 봉한 값에 `keyVersion`을 남깁니다.
 */
export class CredentialVault extends Context.Service<
  CredentialVault,
  {
    seal(fields: SecretFields): Effect.Effect<SealedSecret>
    open(sealed: SealedSecret): Effect.Effect<SecretFields>
  }
>()('semu/integrations/CredentialVault') {
  /** 주어진 키 하나로 암호화합니다. 기본 키는 테스트용 고정 키 {@link DEMO_VAULT_KEY}라 테스트와 컨텍스트 단위 실행에만 씁니다. */
  static readonly layerMemory = (key: Uint8Array = DEMO_VAULT_KEY) =>
    Layer.succeed(
      CredentialVault,
      CredentialVault.of({
        seal: (fields) => Effect.sync(() => sealSecret(key, fields)),
        open: (sealed) => Effect.sync(() => openSecret(key, sealed)),
      }),
    )

  /** {@link DataKey}의 자격 증명용 하위 키로 암호화합니다. 서버가 씁니다. */
  static readonly layerDataKey = Layer.effect(
    CredentialVault,
    Effect.gen(function* () {
      const key = (yield* DataKey).subkey('integrations/credential-vault/aes-256-gcm')
      return CredentialVault.of({
        seal: (fields) => Effect.sync(() => sealSecret(key, fields)),
        open: (sealed) => Effect.sync(() => openSecret(key, sealed)),
      })
    }),
  )
}
