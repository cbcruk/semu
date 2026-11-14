import { Context, Data, Effect, Layer, Option } from 'effect'
import type { PaymentFailureReason } from '../payments/payment.ts'
import type { MandateRejectionReason } from './billing-mandate.ts'

/** 은행망 CMS에 출금 계좌를 등록한 결과입니다. */
export type MandateRegistrationResult =
  { accepted: true; reference: string } | { accepted: false; reason: MandateRejectionReason }

/** 출금 결과 파일에서 찾을 결제 하나입니다. 결제 ID가 출금 요청의 참조입니다. */
export interface WithdrawalItem {
  paymentId: string
  amount: number
  /** 출금할 계좌의 동의입니다. 없으면 출금 요청을 낼 계좌가 없습니다. */
  mandateId?: string | undefined
}

/** 출금 결과 파일 한 줄입니다. */
export interface WithdrawalResultLine {
  paymentId: string
  succeeded: boolean
  failureReason?: PaymentFailureReason | undefined
}

/** CMS에 닿지 못했습니다. 정기 작업이 다음에 다시 시도합니다. */
export class CmsUnavailable extends Data.TaggedError('CmsUnavailable')<{}> {}

/**
 * 은행망 CMS 자동출금 게이트웨이 포트입니다. 계좌 등록은 동기로 받고, 출금 결과는 출금 다음 날 오후에 결과 파일로 끌어옵니다
 * (`withdrawalResults`).
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
    /**
     * `withdrawnOn`에 출금한 결과 파일에서 `items`의 결과를 읽습니다. 결과 파일이 아직 없으면 `None`이고, 파일에 없는 결제는
     * 줄을 돌려주지 않습니다(다음에 다시 봄). 같은 날을 여러 번 읽어도 같은 결과입니다.
     */
    withdrawalResults(
      withdrawnOn: string,
      items: ReadonlyArray<WithdrawalItem>,
    ): Effect.Effect<Option.Option<ReadonlyArray<WithdrawalResultLine>>, CmsUnavailable>
  }
>()('semu/billing/CmsGateway') {
  /**
   * 결정적인 가짜입니다. 계좌번호가 `0000`으로 끝나면 없는 계좌로 거절하고, 나머지는 받아들입니다. `requestId`마다 처음 결과를
   * 기억해, 같은 `requestId`가 다시 오면 입력이 달라도 그 결과를 돌려줍니다.
   *
   * 출금 결과는 늘 파일이 있고, 출금 동의가 없는 결제는 `MANDATE_NOT_REGISTERED`로 실패, 나머지는 성공입니다.
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
      withdrawalResults: (_withdrawnOn, items) =>
        Effect.succeed(
          Option.some(
            items.map((item): WithdrawalResultLine =>
              item.mandateId === undefined
                ? { paymentId: item.paymentId, succeeded: false, failureReason: 'MANDATE_NOT_REGISTERED' }
                : { paymentId: item.paymentId, succeeded: true },
            ),
          ),
        ),
    })
  })
}
