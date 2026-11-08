# 신고 의무와 일정 배치

## 요약

- 일반과세자가 지는 신고 의무(부가세 예정·확정·예정고지, 원천세 매월·반기, 법인세, 종합소득세)의 기간과 법정 기한을 회사 설정으로 계산합니다
- 일정 배치가 매일 오늘부터 120일 안에 납부 기한이 드는 의무를 신고 건으로 만들고, 기한이 바뀐 `scheduled`·`requested` 건을 고치고, 더는 해당하지 않는 `scheduled` 건을 취소합니다
- 한 번 만든 신고 건(취소된 것 포함)은 다시 만들지 않습니다

## 현행 위치

- 의무 계산: `apps/api/legacy/src/modules/tax-calendar/tax-calendar.ts` (`resolveFilingPeriods`)
- 일정 배치: `apps/api/legacy/src/jobs/schedule-filings.ts` (`scheduleFilings`)
- 중복 방지·기한 갱신: `apps/api/legacy/src/modules/filings/filings.repository.ts` (`insertFilingIfAbsent`, `refreshDeadlines`, `listScheduledInWindow`)
- 테스트: `apps/api/legacy/test/tax-calendar.test.ts`
- 매뉴얼: `alfred-manual/06-세무/02-원천세.md`

## 로직

| 세목 | 종류 | 기간 | 법정 기한 |
|---|---|---|---|
| 부가세 | 예정 (법인 + `vat_preliminary_mode = filing`) | 1–3월, 7–9월 | 기간 다음 달 25일 |
| 부가세 | 예정고지 (개인, 또는 법인 고지 모드) | 같음 | 같음. 신고 기한 없음(`due_date = null`) |
| 부가세 | 확정 | 법인 예정 신고면 4–6월·10–12월, 아니면 반기 전체 | 기간 다음 달 25일 |
| 원천세 | 매월 | 지급월 | 다음 달 10일 |
| 원천세 | 반기 | 1–6월, 7–12월 | 7월 10일, 다음 해 1월 10일 |
| 법인세 | 연 | 사업연도(종료 월 기준 12개월) | 종료 월 말일 + 3개월(성실신고확인 + 4개월)의 말일 |
| 종합소득세 | 연 | 1–12월 (개인만) | 다음 해 5월 31일(성실신고확인 6월 30일) |

- 법정 기한을 [신고 기한 이월](filing-deadline-rollover.md)로 미룬 날이 신고·납부 기한입니다
- 결과는 납부 기한이 `from`–`to` 안인 의무만, 납부 기한·세목 순입니다
- 일정 배치 (회사마다 한 트랜잭션)
  - 의무 키(세목 + 기간 키)에 신고 건이 없으면 체크리스트를 복사해 `scheduled`로 만듭니다. 급여 플랜 회사의 원천세는 급여대장 항목을 바로 맞춥니다
  - 신고 건이 있으면(취소 포함) 만들지 않고, `scheduled`·`requested`면 기한만 새로 맞춥니다
  - 배치 기간 안의 `scheduled` 신고 건이 의무에 없으면 `cancelled`로 바꾸고 카드를 모두 닫습니다

## 근거

`apps/api/legacy/src/jobs/schedule-filings.ts`

```ts
export function scheduleFilings(db: DatabaseSync, clock: Clock, horizonDays = 120): ScheduleResult {
  const today = clock.today()
  const to = addDays(today, horizonDays)
  // ...
  for (const company of listCompanies(db)) {
    const periods = resolveFilingPeriods({ company: toCalendarCompany(company), from: today, to, holidays })
    transaction(db, () => {
      for (const period of periods) {
        const filingId = insertFilingIfAbsent(db, company.id, period, templates, now)
        if (filingId !== null) result.created++
        else if (refreshDeadlines(db, company.id, period, now)) result.updated++
      }
      for (const filing of listScheduledInWindow(db, company.id, today, to)) {
        if (expected.has(`${filing.tax_type}:${filing.tax_period_key}`)) continue
        updateFilingStatus(db, filing, 'cancelled', {}, now)
        closeAllCardsOfSource(db, company.id, filing.id, now)
      }
    })
  }
}
```

`apps/api/legacy/src/modules/tax-calendar/tax-calendar.ts`의 `finalize`는 예정고지 건의 `statutoryDue`·`dueDate`를 `null`로 두고 `paymentDue`만 채웁니다.

## 서버 이전 시 주의

- 반기 신고 건의 `quarter`에 2·4를 넣어 현행 `year`/`quarter` 목록 필드를 흉내 냅니다. 추정 값입니다
- 개인 일반과세자는 `vat_preliminary_mode`가 `filing`이어도 예정고지입니다
- 예정고지 건의 납부 기한을 법정 25일로 미리 채웁니다. 실제 고지서 기한은 대리인이 `recordNotice`로 넣습니다
- 간이과세자, 법인세 중간예납, 연말정산은 일정에 없습니다
- 대리인이 취소한 신고 건은 의무가 남아 있어도 다시 만들지 않습니다
- `requested` 이후 신고 건은 의무가 사라져도 자동 취소하지 않습니다

## 픽스처

[`apps/api/test/fixtures/rules/filing-obligations.json`](../../../apps/api/test/fixtures/rules/filing-obligations.json): 26건 (모두 traced)

| 케이스 | 입력 요지 | 결과 |
|---|---|---|
| 기간 계산 17건 | 법인·개인, 예정·고지 모드, 매월·반기 원천세, 결산 월 12·6·3월, 성실신고 | 기간·기간 키·법정 기한·미룬 기한 |
| 배치 기간 2건 | 2026년 11월, 2027년 1월 | 납부 기한 순 목록 |
| 배치 7건 | 없음 → 생성, 같음 → 아무것도 안 함, 공휴일 변경 → `requested` 갱신, `submitted`는 유지, 해당 없음 → `scheduled` 취소·`requested` 유지, 취소된 건 → 다시 안 만듦 | |
