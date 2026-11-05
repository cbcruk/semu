import { Schema } from 'effect'
import { isCalendarDate } from '../../shared/time/date-format.ts'

/** 0 이상의 원 단위 금액입니다. */
export const Won = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))

/** 부호가 있는 원 단위 금액입니다. 근태공제처럼 음수 지급 줄에 씁니다. */
export const SignedWon = Schema.Int

/** ppm 요율입니다(1% = 10,000). */
export const RatePpm = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))

/** 0 이상의 분입니다. 근무 시간은 분 단위 정수로 주고받습니다. */
export const Minutes = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))

/** 달 `YYYY-MM`입니다. 귀속월·지급월·기준표 적용 시작월에 씁니다. */
export const YearMonthString = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/)))

/** 날짜 `YYYY-MM-DD`입니다. 실제로 있는 날짜만 받습니다. */
export const CalendarDate = Schema.String.pipe(Schema.refine((value): value is string => isCalendarDate(value)))

/** 근로자가 고를 수 있는 원천징수 비율(ppm)입니다. 80%·100%·120%입니다. */
export const WithholdingRatePpm = Schema.Literals([800_000, 1_000_000, 1_200_000])

/** 쿼리 문자열의 연도입니다. 예: `2026` */
export const YearFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 2000, maximum: 2100 })),
)
