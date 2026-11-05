import { Context, Effect, Layer } from 'effect'

/** 2026년 관공서 공휴일과 대체공휴일입니다. 메모리 구현의 기본값입니다. */
export const KOREAN_HOLIDAYS_2026: ReadonlyArray<string> = [
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-03-01',
  '2026-03-02',
  '2026-05-05',
  '2026-05-24',
  '2026-05-25',
  '2026-06-03',
  '2026-06-06',
  '2026-08-15',
  '2026-08-17',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-10-03',
  '2026-10-05',
  '2026-10-09',
  '2026-12-25',
]

/**
 * 은행망이 쉬는 공휴일 참조데이터 포트입니다. 출금일을 다음 영업일로 미루는 데 씁니다.
 *
 * 급여 지급일·신고 기한도 같은 데이터가 필요하므로 공유 참조데이터로 옮길 후보입니다.
 */
export class PublicHolidays extends Context.Service<
  PublicHolidays,
  {
    all(): Effect.Effect<ReadonlySet<string>>
  }
>()('semu/billing/PublicHolidays') {
  /** 고정된 공휴일 목록입니다. */
  static readonly layerMemory = (dates: ReadonlyArray<string> = KOREAN_HOLIDAYS_2026) => {
    const holidays = new Set(dates)
    return Layer.succeed(PublicHolidays, PublicHolidays.of({ all: () => Effect.succeed(holidays) }))
  }
}
