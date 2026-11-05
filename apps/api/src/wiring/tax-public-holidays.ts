import { Effect, Layer } from 'effect'
import { PublicHolidayCalendar } from '../shared/time/public-holidays.ts'
import { PublicHolidays } from '../modules/tax/tax.public.ts'

/** Tax의 `PublicHolidays` 포트를 공유 쉬는 날 참조데이터(`PublicHolidayCalendar`)로 구현합니다. 신고·납부 기한을 미루는 데 씁니다. */
export const TaxPublicHolidaysFromCalendar: Layer.Layer<PublicHolidays, never, PublicHolidayCalendar> = Layer.effect(
  PublicHolidays,
  Effect.gen(function* () {
    const calendar = yield* PublicHolidayCalendar
    return PublicHolidays.of({ between: (from, to) => calendar.between(from, to) })
  }),
)
