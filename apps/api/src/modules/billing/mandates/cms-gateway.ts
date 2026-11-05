import { Context, Effect, Layer } from 'effect'
import type { MandateRejectionReason } from './billing-mandate.ts'

/** 은행망 CMS에 출금 계좌를 등록한 결과입니다. */
export type MandateRegistrationResult =
  { accepted: true; reference: string } | { accepted: false; reason: MandateRejectionReason }

/**
 * 은행망 CMS 자동출금 게이트웨이 포트입니다. 계좌 등록만 동기로 받고, 출금 결과는 다음 날 결과 파일로 옵니다.
 *
 * 실제 구현은 금융결제원 CMS 전문을 다룹니다. 계좌번호 원문은 이 포트로만 넘기고 저장하지 않습니다.
 */
export class CmsGateway extends Context.Service<
  CmsGateway,
  {
    registerAccount(input: {
      bankCode: string
      accountNumber: string
      accountHolder: string
      payerNumber: string
    }): Effect.Effect<MandateRegistrationResult>
  }
>()('semu/billing/CmsGateway') {
  /** 결정적인 가짜입니다. 계좌번호가 `0000`으로 끝나면 없는 계좌로 거절하고, 나머지는 받아들입니다. */
  static readonly layerFake = Layer.succeed(
    CmsGateway,
    CmsGateway.of({
      registerAccount: (input) => {
        const digits = input.accountNumber.replaceAll('-', '')
        return Effect.succeed(
          digits.endsWith('0000')
            ? { accepted: false, reason: 'ACCOUNT_NOT_FOUND' }
            : { accepted: true, reference: `cms-${input.bankCode}-${digits.slice(-4)}` },
        )
      },
    }),
  )
}
