# 신고 기한 이월

## 요약

- 법정 신고·납부 기한이 토요일·일요일·공휴일이면 그다음 영업일로 미룹니다
- 공휴일은 `public_holidays` 표의 날짜이고, 대체공휴일·임시공휴일·근로자의 날(5월 1일)을 넣습니다
- 미룬 날이 다시 쉬는 날이면 계속 미룹니다. 기한이 아닌 날의 공휴일은 영향이 없습니다

## 현행 위치

- 계산: `apps/api/legacy/src/modules/tax-calendar/tax-calendar.utils.ts` (`applyDeadlineRollover`, `isNonBusinessDay`)
- 설계: `docs/reference/legacy-design/tax-api-design.md` 5절 "신고 기한 계산"
- 요일 검증 테스트: `apps/api/legacy/test/tax-calendar.test.ts`

## 로직

- `isNonBusinessDay(date)` = 토요일 또는 일요일 또는 공휴일 표에 있음
- `applyDeadlineRollover(date)` = 쉬는 날이 아닐 때까지 하루씩 더합니다
- 신고 기한과 납부 기한은 같은 법정일에서 같은 방식으로 미루므로 항상 같은 날입니다
- 공휴일 표가 바뀌면 일정 배치가 `scheduled`·`requested` 신고 건의 기한을 다시 계산합니다. `submitted` 이후는 그대로 둡니다

## 근거

`apps/api/legacy/src/modules/tax-calendar/tax-calendar.utils.ts`

```ts
export function applyDeadlineRollover(date: PlainDate, holidays: ReadonlySet<PlainDate>): PlainDate {
  let current = date
  while (isNonBusinessDay(current, holidays)) current = addDays(current, 1)
  return current
}

export function isNonBusinessDay(date: PlainDate, holidays: ReadonlySet<PlainDate>): boolean {
  const weekday = dayOfWeek(date)
  return weekday === 0 || weekday === 6 || holidays.has(date)
}
```

국세기본법 제5조는 기한이 공휴일·토요일·근로자의 날이면 다음 날을 기한으로 봅니다. 레거시 테스트는 2025–2027년 기한의 요일을 달력으로 확인했습니다.

## 서버 이전 시 주의

- 공휴일 표를 누가 관리하는지 정해져 있지 않습니다. 임시공휴일은 지정 뒤 수동으로 넣어야 합니다
- 법인세 분납·연부연납처럼 납부 기한이 신고 기한과 다른 예외를 다루지 않습니다
- 이미 `submitted` 이후인 신고 건은 공휴일이 바뀌어도 기한이 그대로입니다

## 픽스처

[`apps/api/test/fixtures/rules/filing-deadline-rollover.json`](../../../apps/api/test/fixtures/rules/filing-deadline-rollover.json): 13건 (모두 traced)

| 케이스 | 입력 요지 | 결과 |
|---|---|---|
| 토요일 기한 | 2026-07-25 (1기 확정 부가세) | 2026-07-27 |
| 일요일 기한 | 2026-05-31 (2025년 종합소득세) | 2026-06-01 |
| 평일 기한 | 2026-11-10 (10월 원천세) | 그대로 |
| 주말 뒤 공휴일 | 토·일·월(공휴일) | 화요일 |
| 기한이 아닌 날의 공휴일 | 기한 전날이 공휴일 | 그대로 |
