import { Context, Effect, Layer } from 'effect'
import { DataKey, decryptString, encryptString } from '../../../shared/crypto/data-key.ts'

/**
 * 계좌번호 암복호화 포트입니다. 회사 계좌·거래처 계좌·지로 출금 계좌 원문은 이 포트로만 저장합니다.
 *
 * 서버는 {@link AccountNumberCipher.layerAesGcm}(AES-256-GCM, 키는 {@link DataKey}의 계좌번호용 하위 키)을 씁니다.
 * 테스트와 컨텍스트 단위 실행은 {@link AccountNumberCipher.layerFake}를 씁니다.
 */
export class AccountNumberCipher extends Context.Service<
  AccountNumberCipher,
  {
    encrypt(plaintext: string): string
    decrypt(token: string): string
  }
>()('semu/bookkeeping/AccountNumberCipher') {
  /** 문자를 뒤집고 접두사를 붙이는 결정적인 가짜입니다. 암호화가 아닙니다. 테스트와 로컬 개발에만 씁니다. */
  static readonly layerFake = Layer.succeed(
    AccountNumberCipher,
    AccountNumberCipher.of({
      encrypt: (plaintext) => `fake:${[...plaintext].reverse().join('')}`,
      decrypt: (token) => [...token.replace(/^fake:/, '')].reverse().join(''),
    }),
  )

  /** AES-256-GCM 암호화입니다. 암호문은 `v1:<iv>:<tag>:<ciphertext>`이고, 바뀐 값은 예외로 거부합니다. */
  static readonly layerAesGcm = Layer.effect(
    AccountNumberCipher,
    Effect.gen(function* () {
      const key = (yield* DataKey).subkey('bookkeeping/account-number/aes-256-gcm')
      return AccountNumberCipher.of({
        encrypt: (plaintext) => encryptString(key, plaintext),
        decrypt: (token) => decryptString(key, token),
      })
    }),
  )
}
