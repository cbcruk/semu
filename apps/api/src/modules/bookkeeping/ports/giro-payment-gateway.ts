import { Context, Effect, Layer } from 'effect'

/** 지로 납부 요청입니다. 계좌 비밀번호는 이 요청으로 한 번 전달하고 저장하지 않습니다. */
export interface GiroPaymentRequest {
  companyId: string
  giroId: string
  electronicPaymentNumber: string
  taxKind: 'NATIONAL' | 'LOCAL'
  bankCode: string
  accountNumber: string
  accountPassword: string
  amount: number
  /**
   * 납부 요청의 멱등 참조입니다. 클라이언트의 `Idempotency-Key` 원문이 아니라 시도마다 만든 값입니다. 결과를 확인하지 못한 납부를
   * 같은 키로 다시 보내면 같은 값이 오고, 구현은 다시 출금하지 않고 처음 결과를 돌려줘야 합니다.
   */
  idempotencyKey: string
}

/** 납부 결과입니다. `resultCode`는 금융결제원 코드 원문입니다. */
export interface GiroPaymentResult {
  ok: boolean
  resultCode: string
  resultMessage: string
}

/** 인터넷지로 납부 포트입니다. Integrations가 금융결제원 출금으로 구현합니다. */
export class GiroPaymentGateway extends Context.Service<
  GiroPaymentGateway,
  {
    pay(request: GiroPaymentRequest): Effect.Effect<GiroPaymentResult>
  }
>()('semu/bookkeeping/GiroPaymentGateway') {
  /**
   * 결정적인 가짜입니다. 비밀번호가 {@link FAKE_WRONG_PASSWORD}이거나 케이뱅크(`089`)로 국세를 내면 거절합니다.
   * 현행 가짜와 같습니다.
   */
  static readonly layerFake = Layer.succeed(
    GiroPaymentGateway,
    GiroPaymentGateway.of({
      pay: (request) =>
        Effect.succeed(
          request.accountPassword === FAKE_WRONG_PASSWORD
            ? { ok: false, resultCode: 'E101', resultMessage: '계좌 비밀번호가 일치하지 않습니다.' }
            : request.bankCode === '089' && request.taxKind === 'NATIONAL'
              ? { ok: false, resultCode: 'E201', resultMessage: '케이뱅크는 지방세·세외수입만 납부할 수 있습니다.' }
              : { ok: true, resultCode: '0000', resultMessage: '정상 처리되었습니다.' },
        ),
    }),
  )
}

/** 가짜 납부 게이트웨이가 거절하는 계좌 비밀번호입니다. */
export const FAKE_WRONG_PASSWORD = '0000'
