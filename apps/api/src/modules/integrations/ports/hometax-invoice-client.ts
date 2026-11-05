import { createHash } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 홈택스 전자세금계산서 발급 요청입니다. `statement`는 발급 시점에 고정한 거래명세서 원문입니다. */
export interface HometaxInvoiceRequest {
  companyId: Id<'company'>
  /** 발급을 요청한 쪽의 거래 식별자입니다. 승인번호를 정하는 데 씁니다. */
  sourceId: string
  /** 같은 키의 재시도는 같은 결과를 돌려줍니다. */
  idempotencyKey: string
  writeDate: string
  buyerBusinessNumber: string | null
  statement: unknown
}

/** 발급 결과입니다. 거절이면 홈택스 오류 코드와 메시지를 담습니다. */
export type HometaxInvoiceResult =
  { ok: true; approvalNumber: string; issuedAt: string } | { ok: false; errorCode: string; errorMessage: string }

/** 가짜 발급기가 거절하는 공급받는 자 사업자번호입니다. */
export const FAKE_REJECTED_BUYER_NUMBER = '0000000000'

/**
 * 홈택스 전자세금계산서 발급 어댑터 포트입니다. 운영에서는 등록한 인증서로 서명해 국세청에 보냅니다.
 *
 * Integrations가 소유하고 `integrations.public.ts`로 엽니다. Bookkeeping의 세금계산서 발행이 `app.ts`의 어댑터로 씁니다.
 */
export class HometaxInvoiceClient extends Context.Service<
  HometaxInvoiceClient,
  {
    issue(request: HometaxInvoiceRequest): Effect.Effect<HometaxInvoiceResult>
    /** 발급분 상세가 홈택스에 있는지입니다. */
    fetchDetail(companyId: Id<'company'>, approvalNumber: string): Effect.Effect<{ found: boolean }>
  }
>()('semu/integrations/HometaxInvoiceClient') {
  /**
   * 결정적인 가짜입니다. 공급받는 자 사업자번호가 {@link FAKE_REJECTED_BUYER_NUMBER}이면 거절하고, 아니면
   * `<작성일>-41000000-<거래 ID 해시 8자리>` 승인번호를 줍니다. 현행 가짜와 같습니다.
   */
  static readonly layerFake: Layer.Layer<HometaxInvoiceClient> = Layer.succeed(
    HometaxInvoiceClient,
    HometaxInvoiceClient.of({
      issue: (request) =>
        Effect.sync((): HometaxInvoiceResult => {
          if (request.buyerBusinessNumber === FAKE_REJECTED_BUYER_NUMBER) {
            return {
              ok: false,
              errorCode: 'BUYER_NOT_FOUND',
              errorMessage: '공급받는 자의 사업자등록번호를 확인해 주세요.',
            }
          }
          const hash = createHash('sha256').update(request.sourceId).digest('hex').slice(0, 12)
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
