import { Context, Effect, Layer } from 'effect'
import { DataKey, decryptString, encryptString } from '../../../shared/crypto/data-key.ts'

/**
 * 암호화하는 계좌번호 필드입니다. 필드마다 하위 키와 AAD가 달라, 한 필드의 암호문을 다른 필드로 옮기면 열리지 않습니다.
 *
 * - `companyAccount`: 회사 계좌(은행 계좌 수집)
 * - `partnerAccount`: 거래처 계좌
 * - `giroAccount`: 지로 납부 출금 계좌
 */
export type AccountNumberField = 'companyAccount' | 'partnerAccount' | 'giroAccount'

/**
 * 계좌번호 암복호화 포트입니다. 회사 계좌·거래처 계좌·지로 출금 계좌 원문은 이 포트로만 저장합니다.
 *
 * 서버는 {@link AccountNumberCipher.layerAesGcm}(AES-256-GCM, 키는 {@link DataKey}의 필드별 하위 키)을 씁니다.
 * 테스트와 컨텍스트 단위 실행은 {@link AccountNumberCipher.layerFake}를 씁니다.
 */
export class AccountNumberCipher extends Context.Service<
  AccountNumberCipher,
  {
    encrypt(field: AccountNumberField, plaintext: string): string
    decrypt(field: AccountNumberField, token: string): string
  }
>()('semu/bookkeeping/AccountNumberCipher') {
  /** 문자를 뒤집고 접두사를 붙이는 결정적인 가짜입니다. 암호화가 아닙니다. 테스트와 로컬 개발에만 씁니다. */
  static readonly layerFake = Layer.succeed(
    AccountNumberCipher,
    AccountNumberCipher.of({
      encrypt: (_field, plaintext) => `fake:${[...plaintext].reverse().join('')}`,
      decrypt: (_field, token) => [...token.replace(/^fake:/, '')].reverse().join(''),
    }),
  )

  /**
   * AES-256-GCM 암호화입니다. 암호문은 `v2:<iv>:<tag>:<ciphertext>`이고 필드 용도(`bookkeeping/<field>`)를 AAD로 묶습니다.
   * 바뀐 값, 다른 키, 다른 필드의 암호문은 `DecryptionFailed`로 거부합니다.
   */
  static readonly layerAesGcm = Layer.effect(
    AccountNumberCipher,
    Effect.gen(function* () {
      const dataKey = yield* DataKey
      const purposeOf = (field: AccountNumberField) => `bookkeeping/${field}/aes-256-gcm`
      const keys: Record<AccountNumberField, Uint8Array> = {
        companyAccount: dataKey.subkey(purposeOf('companyAccount')),
        partnerAccount: dataKey.subkey(purposeOf('partnerAccount')),
        giroAccount: dataKey.subkey(purposeOf('giroAccount')),
      }
      return AccountNumberCipher.of({
        encrypt: (field, plaintext) => encryptString(keys[field], purposeOf(field), plaintext),
        decrypt: (field, token) => decryptString(keys[field], purposeOf(field), token),
      })
    }),
  )
}
