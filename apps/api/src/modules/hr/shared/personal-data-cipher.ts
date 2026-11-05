import { createHmac } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { DataKey, decryptString, encryptString } from '../../../shared/crypto/data-key.ts'

/**
 * 주민등록번호·계좌번호 암호화와 중복 판정용 해시입니다.
 *
 * 서버 구현({@link PersonalDataCipher.layerAesGcm})은 AES-256-GCM과 회사와 무관한 HMAC-SHA256을 쓰고, 두 키 모두 {@link DataKey}에서
 * 용도별로 따로 만듭니다. 암호문은 매번 달라 비교할 수 없으므로 중복은 {@link PersonalDataCipher} `hash`로 찾습니다.
 */
export class PersonalDataCipher extends Context.Service<
  PersonalDataCipher,
  {
    encrypt(plain: string): Effect.Effect<string>
    decrypt(cipherText: string): Effect.Effect<string>
    /** 같은 값이면 같은 결과가 나오는 키 해시입니다. */
    hash(plain: string): Effect.Effect<string>
  }
>()('semu/hr/PersonalDataCipher') {
  /** 테스트·로컬 개발용 가짜입니다. 암호문은 `enc:` 접두사를 붙인 base64이고, 해시는 고정 키 HMAC입니다. */
  static readonly layerFake = Layer.succeed(
    PersonalDataCipher,
    PersonalDataCipher.of({
      encrypt: (plain) => Effect.succeed(`enc:${Buffer.from(plain, 'utf8').toString('base64')}`),
      decrypt: (cipherText) => Effect.succeed(Buffer.from(cipherText.replace(/^enc:/, ''), 'base64').toString('utf8')),
      hash: (plain) => Effect.succeed(createHmac('sha256', 'semu-fake-hmac-key').update(plain).digest('hex')),
    }),
  )

  /**
   * AES-256-GCM 암호화와 HMAC-SHA256 해시입니다. 서버(`SqliteLive`)가 씁니다.
   *
   * 암호문은 `v1:<iv>:<tag>:<ciphertext>`이고, 바뀐 값이나 다른 키의 암호문은 결함(defect)으로 끝납니다.
   */
  static readonly layerAesGcm = Layer.effect(
    PersonalDataCipher,
    Effect.gen(function* () {
      const dataKey = yield* DataKey
      const encryptionKey = dataKey.subkey('hr/personal-data/aes-256-gcm')
      const hashKey = dataKey.subkey('hr/personal-data/hmac-sha256')
      return PersonalDataCipher.of({
        encrypt: (plain) => Effect.sync(() => encryptString(encryptionKey, plain)),
        decrypt: (cipherText) => Effect.sync(() => decryptString(encryptionKey, cipherText)),
        hash: (plain) => Effect.sync(() => createHmac('sha256', hashKey).update(plain).digest('hex')),
      })
    }),
  )
}
