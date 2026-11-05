import { Context, Layer } from 'effect'

/**
 * 계좌번호 암복호화 포트입니다. 회사 계좌·거래처 계좌·지로 출금 계좌 원문은 이 포트로만 저장합니다.
 *
 * 키 관리는 Identity & Access의 비밀 보관과 같은 KMS를 쓸 예정입니다. 지금은 가짜만 있습니다.
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
}
