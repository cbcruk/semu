import { Schema } from 'effect'
import { isCalendarDate } from './date-format.ts'

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * `YYYY-MM-DD` 형식의 실제 날짜입니다. 입사일·지급일처럼 "그날"이 의미인 값에 씁니다 (`docs/design/conventions.md`).
 *
 * 형식이 틀리거나 없는 날(`2026-02-30`)이면 요청 스키마가 400 `VALIDATION_FAILED`로 거부합니다.
 */
export const CalendarDate = Schema.String.check(Schema.makeFilter<string>((value) => isCalendarDate(value)))

/** `YYYY-MM` 형식의 달입니다. 귀속월·지급월·과세기간처럼 달이 단위인 값에 씁니다. */
export const YearMonth = Schema.String.check(Schema.makeFilter<string>((value) => YEAR_MONTH.test(value)))
