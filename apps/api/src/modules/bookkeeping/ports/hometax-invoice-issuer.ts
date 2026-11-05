import { createHash } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'

/** 홈택스에 보내는 발급 요청입니다. `statement`는 발급 시점에 고정한 거래명세서입니다. */
export interface InvoiceIssueRequest {
  companyId: string
  salesTransactionId: string
  /** 같은 키의 재시도는 같은 결과를 돌려줘야 합니다. */
  idempotencyKey: string
  writeDate: string
  buyerBusinessNumber: string | null
  statement: unknown
}

/** 발급 결과입니다. 거절이면 홈택스 오류 코드와 메시지를 담습니다. */
export type InvoiceIssueResult =
  { ok: true; approvalNumber: string; issuedAt: string } | { ok: false; errorCode: string; errorMessage: string }

/**
 * 홈택스 전자세금계산서 발급 포트입니다. Integrations가 인증서 서명과 국세청 전송으로 구현합니다.
 *
 * 현행은 120초 동기 대기였습니다. 실제 구현은 `Job`으로 바꿀 수 있게 결과만 돌려줍니다.
 */
export class HometaxInvoiceIssuer extends Context.Service<
  HometaxInvoiceIssuer,
  {
    issue(request: InvoiceIssueRequest): Effect.Effect<InvoiceIssueResult>
    /** 발급분 상세가 홈택스에 있는지입니다. */
    fetchDetail(companyId: string, approvalNumber: string): Effect.Effect<{ found: boolean }>
  }
>()('semu/bookkeeping/HometaxInvoiceIssuer') {
  /**
   * 결정적인 가짜입니다. 공급받는 자 사업자번호가 {@link FAKE_REJECTED_BUYER_NUMBER}이면 거절하고, 아니면
   * `<작성일>-41000000-<거래명세서 ID 해시 8자리>` 승인번호를 줍니다. 현행 가짜와 같습니다.
   */
  static readonly layerFake = Layer.succeed(
    HometaxInvoiceIssuer,
    HometaxInvoiceIssuer.of({
      issue: (request) =>
        Effect.sync(() => {
          if (request.buyerBusinessNumber === FAKE_REJECTED_BUYER_NUMBER) {
            return {
              ok: false,
              errorCode: 'BUYER_NOT_FOUND',
              errorMessage: '공급받는 자의 사업자등록번호를 확인해 주세요.',
            }
          }
          const hash = createHash('sha256').update(request.salesTransactionId).digest('hex').slice(0, 12)
          const digits = (Number.parseInt(hash, 16) % 100_000_000).toString().padStart(8, '0')
          return {
            ok: true,
            approvalNumber: `${request.writeDate.replaceAll('-', '')}-41000000-${digits}`,
            issuedAt: `${request.writeDate}T09:00:00+09:00`,
          }
        }),
      fetchDetail: () => Effect.succeed({ found: true }),
    }),
  )
}

/** 가짜 발급기가 거절하는 공급받는 자 사업자번호입니다. 실패 경로 테스트에 씁니다. */
export const FAKE_REJECTED_BUYER_NUMBER = '0000000000'
