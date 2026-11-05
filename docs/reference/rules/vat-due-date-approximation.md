# 홈 부가세 납부 기한 근사

## 요약

- 현행 홈 카드는 예상 부가세 기간이 끝난 다음 달 25일을 납부 기한으로 보입니다
- 주말·공휴일은 미루지 않고, 남은 날은 오늘부터 기한까지의 일수입니다(당일 0, 지나면 음수)
- 재설계는 이 근사 대신 Tax가 세무 일정으로 준 기한을 씁니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/realtime-reports/realtime-reports.service.ts:267-294` (`homeSummaryCards`)
- 월 넘김: `apps/api/legacy/src/lib/plain-date.ts:27-30` (`fromParts`가 13월을 다음 해 1월로 넘김)

## 로직

- `dueDate = fromParts(기간 끝 연도, 기간 끝 월 + 1, 25)`
- `daysUntilDue = daysBetween(오늘, dueDate)`
- 기간은 법인 분기, 개인 반기입니다(Tax의 예상 부가세가 정합니다)

## 근거

- 현행 코드 주석 `realtime-reports.service.ts:270-271`
  > `vat.due_in_days` counts to the 25th of the month after the estimate period, without holiday adjustment; the tax calendar has the exact date.

## 서버 이전 시 주의

- 2026-04-25(토)처럼 휴일이 기한으로 보입니다. 세무 일정은 다음 영업일로 미룹니다
- 재설계는 포트 `VatEstimateSource.current(companyId, businessType, today)`가 기간·예상 세액·기한을 함께 줍니다. 근사 함수(`approximateVatDueDate`)는 가짜 구현과 비교용으로만 남깁니다

## 픽스처

`apps/api/test/fixtures/rules/vat-due-date-approximation.json` (4케이스)
