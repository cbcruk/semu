import { Effect, Layer } from 'effect'
import type { Id } from '../shared/ids/ids.types.ts'
import {
  BusinessStatusLookup,
  GiroPaymentGateway,
  HometaxInvoiceIssuer,
} from '../modules/bookkeeping/bookkeeping.public.ts'
import type { BusinessStatus, BusinessStatusAnswer } from '../modules/bookkeeping/bookkeeping.public.ts'
import {
  BusinessStatusClient,
  GiroPaymentClient,
  HometaxInvoiceClient,
} from '../modules/integrations/integrations.public.ts'
import type { BusinessStatusCode, BusinessStatusResult, TaxType } from '../modules/integrations/integrations.public.ts'

const STATUS: Readonly<Record<BusinessStatusCode, BusinessStatus>> = {
  ACTIVE: 'REGISTERED',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED',
  UNREGISTERED: 'UNKNOWN',
}

const TAXATION_TYPE: Readonly<Record<TaxType, string>> = {
  GENERAL: '일반과세자',
  SIMPLIFIED: '간이과세자',
  TAX_EXEMPT: '면세사업자',
  NON_PROFIT: '비영리법인·국가기관',
}

/**
 * Bookkeeping의 `BusinessStatusLookup` 포트를 Integrations의 국세청 사업자 상태조회(`BusinessStatusClient`)로 구현합니다.
 *
 * 상태는 계속사업자(`ACTIVE`)를 `REGISTERED`로, 미등록(`UNREGISTERED`)을 `UNKNOWN`으로 옮깁니다. 과세 유형은 국세청 표기
 * (`일반과세자` 등)로 바꿉니다. 캐시는 Bookkeeping이 거래처마다 따로 둡니다.
 */
export const BookkeepingBusinessStatusFromIntegrations: Layer.Layer<BusinessStatusLookup, never, BusinessStatusClient> =
  Layer.effect(
    BusinessStatusLookup,
    Effect.gen(function* () {
      const client = yield* BusinessStatusClient
      return BusinessStatusLookup.of({
        lookup: (businessNumber) => client.lookup(businessNumber).pipe(Effect.map(businessStatusAnswerOf)),
      })
    }),
  )

/** Bookkeeping의 `HometaxInvoiceIssuer` 포트를 Integrations의 홈택스 세금계산서 발급 어댑터(`HometaxInvoiceClient`)로 구현합니다. */
export const BookkeepingInvoiceIssuerFromIntegrations: Layer.Layer<HometaxInvoiceIssuer, never, HometaxInvoiceClient> =
  Layer.effect(
    HometaxInvoiceIssuer,
    Effect.gen(function* () {
      const client = yield* HometaxInvoiceClient
      return HometaxInvoiceIssuer.of({
        issue: (request) =>
          client.issue({
            companyId: request.companyId as Id<'company'>,
            sourceId: request.salesTransactionId,
            idempotencyKey: request.idempotencyKey,
            writeDate: request.writeDate,
            buyerBusinessNumber: request.buyerBusinessNumber,
            statement: request.statement,
          }),
        fetchDetail: (companyId, approvalNumber) => client.fetchDetail(companyId as Id<'company'>, approvalNumber),
      })
    }),
  )

/** Bookkeeping의 `GiroPaymentGateway` 포트를 Integrations의 인터넷지로 납부 어댑터(`GiroPaymentClient`)로 구현합니다. */
export const BookkeepingGiroPaymentFromIntegrations: Layer.Layer<GiroPaymentGateway, never, GiroPaymentClient> =
  Layer.effect(
    GiroPaymentGateway,
    Effect.gen(function* () {
      const client = yield* GiroPaymentClient
      return GiroPaymentGateway.of({
        pay: (request) =>
          client.pay({
            companyId: request.companyId as Id<'company'>,
            electronicPaymentNumber: request.electronicPaymentNumber,
            taxKind: request.taxKind,
            bankCode: request.bankCode,
            accountNumber: request.accountNumber,
            accountPassword: request.accountPassword,
            amount: request.amount,
            idempotencyKey: request.idempotencyKey,
          }),
      })
    }),
  )

/** Bookkeeping이 Integrations에서 받는 외부 연동 포트 셋입니다. */
export const BookkeepingIntegrationsLive: Layer.Layer<
  BusinessStatusLookup | HometaxInvoiceIssuer | GiroPaymentGateway,
  never,
  BusinessStatusClient | HometaxInvoiceClient | GiroPaymentClient
> = Layer.mergeAll(
  BookkeepingBusinessStatusFromIntegrations,
  BookkeepingInvoiceIssuerFromIntegrations,
  BookkeepingGiroPaymentFromIntegrations,
)

function businessStatusAnswerOf(result: BusinessStatusResult): BusinessStatusAnswer {
  return {
    status: STATUS[result.status],
    taxationType: result.taxType === undefined ? null : TAXATION_TYPE[result.taxType],
    closedOn: result.closedOn ?? null,
  }
}
