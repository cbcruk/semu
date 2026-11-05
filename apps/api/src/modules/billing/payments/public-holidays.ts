import { Context, Effect, Layer } from 'effect'
import { KOREAN_PUBLIC_HOLIDAYS } from '../../../shared/time/public-holidays.ts'

/**
 * 은행망이 쉬는 공휴일 참조데이터 포트입니다. 출금일을 다음 영업일로 미루는 데 씁니다.
 *
 * `app.ts`는 공유 참조데이터(`shared/time/public-holidays.ts`)로 채웁니다. 메모리 구현은 Billing만 시험할 때 씁니다.
 */
export class PublicHolidays extends Context.Service<
  PublicHolidays,
  {
    all(): Effect.Effect<ReadonlySet<string>>
  }
>()('semu/billing/PublicHolidays') {
  /** 고정된 공휴일 목록입니다. 기본은 공유 참조데이터의 표입니다. */
  static readonly layerMemory = (dates: ReadonlyArray<string> = KOREAN_PUBLIC_HOLIDAYS) => {
    const holidays = new Set(dates)
    return Layer.succeed(PublicHolidays, PublicHolidays.of({ all: () => Effect.succeed(holidays) }))
  }
}
