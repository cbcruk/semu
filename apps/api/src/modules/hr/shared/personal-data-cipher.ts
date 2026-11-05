import { createHmac } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'

/**
 * 주민등록번호·계좌번호 암호화와 중복 판정용 해시입니다.
 *
 * 운영 구현은 AES-256-GCM(키는 KMS)과 회사와 무관한 HMAC-SHA256 키를 씁니다. 암호문은 매번 달라 비교할 수 없으므로
 * 중복은 {@link PersonalDataCipher} `hash`로 찾습니다.
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
}
