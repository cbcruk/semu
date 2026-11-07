import { Context, Effect, Layer } from 'effect'
import type { MandateRejectionReason } from './billing-mandate.ts'

/** 은행망 CMS에 출금 계좌를 등록한 결과입니다. */
export type MandateRegistrationResult =
  { accepted: true; reference: string } | { accepted: false; reason: MandateRejectionReason }

/**
 * 은행망 CMS 자동출금 게이트웨이 포트입니다. 계좌 등록만 동기로 받고, 출금 결과는 다음 날 결과 파일로 옵니다.
 *
 * 실제 구현은 금융결제원 CMS 전문을 다룹니다. 계좌번호 원문은 이 포트로만 넘기고 저장하지 않습니다.
 *
 * `requestId`는 등록 요청의 멱등 참조입니다. 결과를 확인하지 못한 등록을 같은 `Idempotency-Key`로 다시 보내면 같은 `requestId`가 오고,
 * 구현은 은행에 다시 등록하지 않고 처음 결과를 돌려줘야 합니다. 중복 응답("이미 처리한 거래")을 거절로 돌려주면 안 됩니다. 원거래를 조회해 그 결과를 돌려주고, 조회하지 못하면 결함으로 끝냅니다.
 * 거절은 확정 실패라 `Idempotency-Key`를 풀고, 다음 재시도가 새 참조로 같은 일을 한 번 더 하기 때문입니다. 참조는 UUID(36자)이고,
 * 고정 길이 전문 필드에 맞추는 것(줄이거나 대응 표를 두는 것)은 어댑터의 몫입니다.
 */
export class CmsGateway extends Context.Service<
  CmsGateway,
  {
    registerAccount(input: {
      requestId: string
      bankCode: string
      accountNumber: string
      accountHolder: string
      payerNumber: string
    }): Effect.Effect<MandateRegistrationResult>
  }
>()('semu/billing/CmsGateway') {
  /**
   * 결정적인 가짜입니다. 계좌번호가 `0000`으로 끝나면 없는 계좌로 거절하고, 나머지는 받아들입니다. `requestId`마다 처음 결과를
   * 기억해, 같은 `requestId`가 다시 오면 입력이 달라도 그 결과를 돌려줍니다.
   */
  static readonly layerFake = Layer.sync(CmsGateway, () => {
    const results = new Map<string, MandateRegistrationResult>()
    return CmsGateway.of({
      registerAccount: (input) =>
        Effect.sync(() => {
          const known = results.get(input.requestId)
          if (known !== undefined) return known
          const digits = input.accountNumber.replaceAll('-', '')
          const result: MandateRegistrationResult = digits.endsWith('0000')
            ? { accepted: false, reason: 'ACCOUNT_NOT_FOUND' }
            : { accepted: true, reference: `cms-${input.bankCode}-${digits.slice(-4)}` }
          results.set(input.requestId, result)
          return result
        }),
    })
  })
}
