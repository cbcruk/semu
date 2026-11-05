import { Context, Effect, Layer } from 'effect'

/** 국세청 기준 사업자 상태입니다. */
export type BusinessStatusCode = 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'UNREGISTERED'

/** 과세 유형입니다. */
export type TaxType = 'GENERAL' | 'SIMPLIFIED' | 'TAX_EXEMPT' | 'NON_PROFIT'

/** 사업자 상태 조회 결과입니다. */
export interface BusinessStatusResult {
  status: BusinessStatusCode
  taxType?: TaxType
  closedOn?: string
}

/** 국세청 사업자 상태조회(공공데이터 API) 어댑터 포트입니다. */
export class BusinessStatusClient extends Context.Service<
  BusinessStatusClient,
  {
    lookup(businessNumber: string): Effect.Effect<BusinessStatusResult>
  }
>()('semu/integrations/BusinessStatusClient') {
  /**
   * 결정적인 가짜입니다. `seed`에 없으면 끝자리로 정합니다: 7 휴업, 8 폐업(2025-12-31), 9 미등록, 나머지 일반과세자.
   */
  static readonly layerFake = (seed: Iterable<readonly [string, BusinessStatusResult]> = []) => {
    const known = new Map(seed)
    return Layer.succeed(
      BusinessStatusClient,
      BusinessStatusClient.of({
        lookup: (businessNumber) => Effect.succeed(known.get(businessNumber) ?? byLastDigit(businessNumber)),
      }),
    )
  }
}

function byLastDigit(businessNumber: string): BusinessStatusResult {
  switch (businessNumber.at(-1)) {
    case '7':
      return { status: 'SUSPENDED', taxType: 'GENERAL' }
    case '8':
      return { status: 'CLOSED', taxType: 'GENERAL', closedOn: '2025-12-31' }
    case '9':
      return { status: 'UNREGISTERED' }
    default:
      return { status: 'ACTIVE', taxType: 'GENERAL' }
  }
}
