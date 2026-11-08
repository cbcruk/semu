import { Context, Effect, Layer } from 'effect'

/** 회사 등록 전에 보는 국세청 사업자 상태입니다. 미등록처럼 판정에 쓰지 않는 상태는 `UNKNOWN`입니다. */
export type BusinessStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'UNKNOWN'

/**
 * 회사 등록 전 사업자 상태조회 포트입니다. Integrations `BusinessStatusClient`로 구현하고 `src/wiring/identity-access-integrations.ts`가 잇습니다.
 *
 * 조회가 실패하면(외부 API 장애) 결함으로 끝납니다. 등록은 실패를 허용하므로 `Companies.register`가 결함을 받아 넘깁니다.
 */
export class BusinessStatusCheck extends Context.Service<
  BusinessStatusCheck,
  {
    /** 숫자 10자리 사업자등록번호의 상태입니다. */
    statusOf(businessNumber: string): Effect.Effect<BusinessStatus>
  }
>()('semu/identity-access/BusinessStatusCheck') {
  /**
   * 모든 조회가 결함으로 끝나는 가짜입니다. 외부 API 장애를 흉내 냅니다. 상태별 답은 Integrations의
   * `BusinessStatusClient.layerFake`(끝자리 7 휴업, 8 폐업, 9 미등록)를 배선으로 받아 시험합니다.
   */
  static readonly layerFailing = Layer.succeed(
    BusinessStatusCheck,
    BusinessStatusCheck.of({
      statusOf: () => Effect.die(new Error('business status lookup is unavailable')),
    }),
  )
}
