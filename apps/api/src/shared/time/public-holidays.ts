import { Context, Effect, Layer } from 'effect'

/**
 * 2026–2027년 기한·출금일을 미루는 쉬는 날입니다. 관공서 공휴일, 대체공휴일, 근로자의 날을 넣었고 주말은 넣지 않습니다.
 *
 * 근로자의 날은 관공서 공휴일이 아니지만 국세 기한(국세기본법 제5조)이 미뤄지고 은행도 쉽니다. 해가 바뀌면 다음 해 표를 더합니다.
 */
export const KOREAN_PUBLIC_HOLIDAYS: ReadonlyArray<string> = [
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-03-01',
  '2026-03-02',
  '2026-05-01',
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
  '2027-01-01',
]

/**
 * 컨텍스트가 함께 쓰는 쉬는 날 참조데이터입니다. Tax의 신고 기한과 Billing의 출금일이 같은 표를 봅니다.
 *
 * 각 컨텍스트는 자기 `PublicHolidays` 포트를 두고, `app.ts`의 어댑터(`src/wiring/`)가 이 서비스로 채웁니다.
 */
export class PublicHolidayCalendar extends Context.Service<
  PublicHolidayCalendar,
  {
    /** `[from, to]`(양 끝 포함, `YYYY-MM-DD`) 안의 쉬는 날입니다. */
    between(from: string, to: string): Effect.Effect<ReadonlySet<string>>
    /** 표에 있는 모든 쉬는 날입니다. */
    all(): Effect.Effect<ReadonlySet<string>>
  }
>()('semu/shared/PublicHolidayCalendar') {
  /** 정해 둔 표로 답합니다. 기본은 {@link KOREAN_PUBLIC_HOLIDAYS}입니다. */
  static readonly layerMemory = (
    dates: ReadonlyArray<string> = KOREAN_PUBLIC_HOLIDAYS,
  ): Layer.Layer<PublicHolidayCalendar> => {
    const holidays: ReadonlySet<string> = new Set(dates)
    return Layer.succeed(
      PublicHolidayCalendar,
      PublicHolidayCalendar.of({
        between: (from, to) => Effect.succeed(new Set(dates.filter((date) => date >= from && date <= to))),
        all: () => Effect.succeed(holidays),
      }),
    )
  }
}
