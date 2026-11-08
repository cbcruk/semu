import { addDays } from '../../../shared/time/calendar.ts'
import { companyDateOf } from '../../../shared/time/date-format.ts'

/** 사업자 상태조회 결과를 다시 쓰는 기간(일)입니다. */
export const BUSINESS_STATUS_TTL_DAYS = 1

/**
 * 캐시한 조회 결과를 그대로 쓸 수 있는지입니다.
 *
 * 조회한 날(회사 시간대) + {@link BUSINESS_STATUS_TTL_DAYS}일이 오늘보다 뒤면 씁니다. 즉 같은 날 조회만 다시 씁니다.
 * 시각이 아니라 날짜로 비교하므로 23:59에 조회한 결과도 다음 날 0시에 만료됩니다.
 */
export function isBusinessStatusFresh(checkedAt: string, today: string): boolean {
  const 조회일 = companyDateOf(checkedAt)
  if (조회일 === null) return false
  return addDays(조회일, BUSINESS_STATUS_TTL_DAYS) > today
}

/** 사업자번호를 숫자 10자리로 정리합니다. 형식이 틀리면 `null`입니다. */
export function normalizeBusinessNumber(value: string): string | null {
  const digits = value.replace(/-/g, '')
  return /^\d{10}$/.test(digits) ? digits : null
}
