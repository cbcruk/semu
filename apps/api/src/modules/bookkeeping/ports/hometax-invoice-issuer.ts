import { createHash } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'

/** 홈택스에 보내는 발급 요청입니다. `statement`는 발급 시점에 고정한 거래명세서입니다. */
export interface InvoiceIssueRequest {
  companyId: string
  salesTransactionId: string
  /**
   * 발급 요청의 멱등 참조입니다. 클라이언트의 `Idempotency-Key` 원문이 아니라 시도마다 만든 값이고, 결과를 확인하지 못한 발급을
   * 같은 키로 다시 보내면 같은 값이 옵니다. 같은 값의 재시도는 다시 발급하지 않고 같은 결과를 돌려줘야 합니다. 중복 응답("이미 처리한 거래")을 거절로 돌려주면 안 됩니다. 원거래를 조회해 그 결과를 돌려주고, 조회하지 못하면 결함으로 끝냅니다.
   * 거절은 확정 실패라 `Idempotency-Key`를 풀고, 다음 재시도가 새 참조로 같은 일을 한 번 더 하기 때문입니다. 참조는 UUID(36자)이고,
   * 고정 길이 전문 필드에 맞추는 것(줄이거나 대응 표를 두는 것)은 어댑터의 몫입니다.
   */
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
   * `<작성일>-41000000-<거래명세서 ID 해시 8자리>` 승인번호를 줍니다. 현행 가짜와 같습니다. 참조(`idempotencyKey`)마다 처음 결과를
   * 기억해, 같은 참조가 다시 오면 그 결과를 돌려줍니다.
   */
  static readonly layerFake = Layer.sync(HometaxInvoiceIssuer, () => {
    const results = new Map<string, InvoiceIssueResult>()
    const decide = (request: InvoiceIssueRequest): InvoiceIssueResult => {
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
    }
    return HometaxInvoiceIssuer.of({
      issue: (request) =>
        Effect.sync(() => {
          const result = results.get(request.idempotencyKey) ?? decide(request)
          results.set(request.idempotencyKey, result)
          return result
        }),
      fetchDetail: () => Effect.succeed({ found: true }),
    })
  })
}

/** 가짜 발급기가 거절하는 공급받는 자 사업자번호입니다. 실패 경로 테스트에 씁니다. */
export const FAKE_REJECTED_BUYER_NUMBER = '0000000000'
