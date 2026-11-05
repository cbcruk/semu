import { Context, Effect, Layer } from 'effect'

/** 국세청 사업자 상태입니다. */
export type BusinessStatus = 'REGISTERED' | 'SUSPENDED' | 'CLOSED' | 'UNKNOWN'

/** 사업자 상태조회 한 번의 답입니다. */
export interface BusinessStatusAnswer {
  status: BusinessStatus
  /** 과세 유형 원문입니다. 예: `일반과세자` */
  taxationType: string | null
  /** 폐업일입니다. 폐업이 아니면 `null`입니다. */
  closedOn: string | null
}

/**
 * 사업자 휴·폐업 상태조회 포트입니다. Integrations가 국세청 조회로 구현합니다 (`docs/design/README.md`).
 *
 * 캐시는 Bookkeeping이 맡습니다 (`docs/reference/rules/business-status-cache.md`).
 */
export class BusinessStatusLookup extends Context.Service<
  BusinessStatusLookup,
  {
    lookup(businessNumber: string): Effect.Effect<BusinessStatusAnswer>
  }
>()('semu/bookkeeping/BusinessStatusLookup') {
  /** 끝자리 `9`는 폐업, `8`은 휴업, 나머지는 일반과세자 계속사업자로 답하는 결정적인 가짜입니다. 현행 가짜와 같습니다. */
  static readonly layerFake = Layer.succeed(
    BusinessStatusLookup,
    BusinessStatusLookup.of({
      lookup: (businessNumber) =>
        Effect.succeed(
          businessNumber.endsWith('9')
            ? { status: 'CLOSED', taxationType: '일반과세자', closedOn: '2025-12-31' }
            : businessNumber.endsWith('8')
              ? { status: 'SUSPENDED', taxationType: '일반과세자', closedOn: null }
              : { status: 'REGISTERED', taxationType: '일반과세자', closedOn: null },
        ),
    }),
  )
}
