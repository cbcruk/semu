import { Effect, Layer } from 'effect'
import { PublicHolidayCalendar } from '../shared/time/public-holidays.ts'
import { PublicHolidays } from '../modules/billing/billing.public.ts'

/** Billing의 `PublicHolidays` 포트를 공유 쉬는 날 참조데이터(`PublicHolidayCalendar`)로 구현합니다. CMS 출금일을 미루는 데 씁니다. */
export const BillingPublicHolidaysFromCalendar: Layer.Layer<PublicHolidays, never, PublicHolidayCalendar> =
  Layer.effect(
    PublicHolidays,
    Effect.gen(function* () {
      const calendar = yield* PublicHolidayCalendar
      return PublicHolidays.of({ all: () => calendar.all() })
    }),
  )
