import { createHmac } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { DataKey, decryptString, encryptString } from '../crypto/data-key.ts'

/**
 * 암호화하는 개인정보 필드입니다. 필드마다 하위 키와 AAD가 달라, 한 필드의 암호문을 다른 필드로 옮기면 열리지 않습니다.
 *
 * - `registrationNumber`: HR 직원의 주민등록번호·외국인등록번호·여권번호
 * - `accountNumber`: HR 급여계약의 급여 계좌번호
 * - `earnerRegistrationNumber`: Payroll 소득자 명부의 주민등록번호·외국인등록번호·여권번호
 */
export type PersonalDataField = 'registrationNumber' | 'accountNumber' | 'earnerRegistrationNumber'

/** 필드의 키 용도이자 AAD입니다. 앞자리는 그 필드를 가진 컨텍스트입니다. 바꾸면 이미 저장한 암호문이 열리지 않습니다. */
const PURPOSES: Record<PersonalDataField, string> = {
  registrationNumber: 'hr/registrationNumber/aes-256-gcm',
  accountNumber: 'hr/accountNumber/aes-256-gcm',
  earnerRegistrationNumber: 'payroll/earnerRegistrationNumber/aes-256-gcm',
}

/**
 * 주민등록번호·외국인등록번호·여권번호·계좌번호 암호화와 중복 판정용 해시입니다. HR(직원)과 Payroll(소득자 명부)이 함께 씁니다.
 *
 * 서버 구현({@link PersonalDataCipher.layerAesGcm})은 AES-256-GCM과 회사와 무관한 HMAC-SHA256을 쓰고, 두 키 모두 {@link DataKey}에서
 * 용도별로 따로 만듭니다. 암호문은 매번 달라 비교할 수 없으므로 중복은 {@link PersonalDataCipher} `hash`로 찾습니다.
 */
export class PersonalDataCipher extends Context.Service<
  PersonalDataCipher,
  {
    encrypt(field: PersonalDataField, plain: string): Effect.Effect<string>
    decrypt(field: PersonalDataField, cipherText: string): Effect.Effect<string>
    /** 같은 값이면 같은 결과가 나오는 키 해시입니다. */
    hash(plain: string): Effect.Effect<string>
  }
>()('semu/shared/PersonalDataCipher') {
  /** 테스트·로컬 개발용 가짜입니다. 암호문은 `enc:` 접두사를 붙인 base64이고, 해시는 고정 키 HMAC입니다. */
  static readonly layerFake = Layer.succeed(
    PersonalDataCipher,
    PersonalDataCipher.of({
      encrypt: (_field, plain) => Effect.succeed(`enc:${Buffer.from(plain, 'utf8').toString('base64')}`),
      decrypt: (_field, cipherText) =>
        Effect.succeed(Buffer.from(cipherText.replace(/^enc:/, ''), 'base64').toString('utf8')),
      hash: (plain) => Effect.succeed(createHmac('sha256', 'semu-fake-hmac-key').update(plain).digest('hex')),
    }),
  )

  /**
   * AES-256-GCM 암호화와 HMAC-SHA256 해시입니다. 서버(`SqliteLive`)가 씁니다.
   *
   * 암호문은 `v2:<iv>:<tag>:<ciphertext>`이고 필드 용도({@link PURPOSES})를 AAD로 묶습니다.
   * 바뀐 값, 다른 키, 다른 필드의 암호문은 `DecryptionFailed` 결함(defect)으로 끝납니다.
   */
  static readonly layerAesGcm = Layer.effect(
    PersonalDataCipher,
    Effect.gen(function* () {
      const dataKey = yield* DataKey
      const keys: Record<PersonalDataField, Uint8Array> = {
        registrationNumber: dataKey.subkey(PURPOSES.registrationNumber),
        accountNumber: dataKey.subkey(PURPOSES.accountNumber),
        earnerRegistrationNumber: dataKey.subkey(PURPOSES.earnerRegistrationNumber),
      }
      // 중복 판정 HMAC 키입니다. 공유 서비스로 옮기기 전 용도 문자열(`hr/` 앞자리)을 그대로 써야 HR에 이미 저장한
      // `registrationNumberHash`가 같은 값으로 다시 나옵니다. Payroll 소득자 명부도 이 키를 쓰되 입력에 종류를 붙입니다.
      const hashKey = dataKey.subkey('hr/personal-data/hmac-sha256')
      return PersonalDataCipher.of({
        encrypt: (field, plain) => Effect.sync(() => encryptString(keys[field], PURPOSES[field], plain)),
        decrypt: (field, cipherText) => Effect.sync(() => decryptString(keys[field], PURPOSES[field], cipherText)),
        hash: (plain) => Effect.sync(() => createHmac('sha256', hashKey).update(plain).digest('hex')),
      })
    }),
  )
}
