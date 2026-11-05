import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 인터넷지로 납부 요청입니다. 계좌 비밀번호는 이 요청으로 한 번 전달하고 저장하지 않습니다. */
export interface GiroPaymentOrder {
  companyId: Id<'company'>
  electronicPaymentNumber: string
  taxKind: 'NATIONAL' | 'LOCAL'
  bankCode: string
  accountNumber: string
  accountPassword: string
  amount: number
  idempotencyKey: string
}

/** 납부 결과입니다. `resultCode`는 금융결제원 코드 원문입니다. */
export interface GiroPaymentOutcome {
  ok: boolean
  resultCode: string
  resultMessage: string
}

/** 가짜 납부 어댑터가 거절하는 계좌 비밀번호입니다. */
export const FAKE_WRONG_ACCOUNT_PASSWORD = '0000'

/**
 * 인터넷지로 납부 어댑터 포트입니다. 운영에서는 금융결제원 출금으로 납부합니다.
 *
 * Integrations가 소유하고 `integrations.public.ts`로 엽니다. Bookkeeping의 지로 납부가 `app.ts`의 어댑터로 씁니다.
 */
export class GiroPaymentClient extends Context.Service<
  GiroPaymentClient,
  {
    pay(order: GiroPaymentOrder): Effect.Effect<GiroPaymentOutcome>
  }
>()('semu/integrations/GiroPaymentClient') {
  /**
   * 결정적인 가짜입니다. 비밀번호가 {@link FAKE_WRONG_ACCOUNT_PASSWORD}이거나 케이뱅크(`089`)로 국세를 내면 거절합니다.
   * 현행 가짜와 같습니다.
   */
  static readonly layerFake: Layer.Layer<GiroPaymentClient> = Layer.succeed(
    GiroPaymentClient,
    GiroPaymentClient.of({
      pay: (order) =>
        Effect.succeed(
          order.accountPassword === FAKE_WRONG_ACCOUNT_PASSWORD
            ? { ok: false, resultCode: 'E101', resultMessage: '계좌 비밀번호가 일치하지 않습니다.' }
            : order.bankCode === '089' && order.taxKind === 'NATIONAL'
              ? { ok: false, resultCode: 'E201', resultMessage: '케이뱅크는 지방세·세외수입만 납부할 수 있습니다.' }
              : { ok: true, resultCode: '0000', resultMessage: '정상 처리되었습니다.' },
        ),
    }),
  )
}
