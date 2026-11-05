/**
 * 회사 업무 시간대입니다. 국세청·4대보험 기한과 급여 귀속월이 모두 한국 달력을 따르므로 한 곳에 둡니다.
 *
 * "오늘", 신고 기한, 귀속월 같은 경계는 서버가 이 시간대로 계산합니다 (`docs/design/conventions.md`).
 */
export const COMPANY_TIME_ZONE = 'Asia/Seoul'

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: COMPANY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** 시점(epoch 밀리초)을 회사 시간대의 날짜 `YYYY-MM-DD`로 바꿉니다. */
export function companyDate(epochMillis: number): string {
  return formatter.format(epochMillis)
}

/** 시점(epoch 밀리초)을 회사 시간대의 달 `YYYY-MM`으로 바꿉니다. 급여 귀속월과 부가세 기간에 씁니다. */
export function companyMonth(epochMillis: number): string {
  return companyDate(epochMillis).slice(0, 7)
}
