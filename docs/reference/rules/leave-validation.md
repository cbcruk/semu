# 휴직 검증

## 요약

- 휴직 기간은 입사일 이후·퇴사일 이전이어야 하고, 다른 휴직과 겹칠 수 없습니다
- 유급이면 수당 필수, 실제 복직일은 시작일 다음날 ~ 종료일 다음날, 건강보험 납입고지유예는 1개월 이상 휴직만
- 육아휴직은 근속에 항상 포함합니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/leaves/leaves.service.ts:16, 81-136`
- `alfred-manual/04-인사/02-구성원-정보.md:84-92`
- `docs/reference/spec/hr.md:649-650`
- `leaves.service.ts`의 `toWrite`, `summarizeLeaves`
- 매뉴얼 구성원 정보 휴직 절
- 스펙 R15–R16

## 로직

- 검사 순서: 기간 순서 → 입사일 → 퇴사일 → 유급 수당 → 복직일 → 납입고지유예 → 겹침(`LEAVE_OVERLAP`)
- 겹침은 다른 휴직의 마지막 날(조기 복직이면 복직일 전날)로 판정합니다
- 복귀 예정일 기본값은 종료일 다음날입니다
- 요약: 현재·다가올 휴직, 오늘까지 지난 휴직 일수, 육아휴직 사용 일수와 남은 일수(365일 − 사용)

## 근거

`apps/api/legacy/src/modules/hr/leaves/leaves.service.ts:108-136`

```ts
function toWrite(deps: ServiceDeps, employee: EmployeeRow, input: LeaveInput, selfId: number | null): LeaveWrite {
  if (input.start_date > input.end_date) throw invalidField('end_date', 'The end date must not be before the start date.')
  if (employee.join_date !== null && input.start_date < employee.join_date) throw invalidField('start_date', 'A leave cannot start before the join date.')
  const leaveDate = findRetirementInfo(deps.db, employee.company_id, employee.id)?.leave_date ?? null
  if (leaveDate !== null && input.end_date > leaveDate) throw invalidField('end_date', 'A leave cannot end after the leave date.')
  if (input.is_paid && input.paid_allowance === null) throw invalidField('paid_allowance', 'Enter the paid leave allowance.')
  if (input.actual_return_date !== null && (input.actual_return_date <= input.start_date || input.actual_return_date > addDays(input.end_date, 1))) {
    throw invalidField('actual_return_date', 'The return date must fall after the start and no later than the day after the end.')
  }
  if (input.nhis_notice_deferral && addMonths(input.start_date, 1) > addDays(input.end_date, 1)) {
    throw invalidField('nhis_notice_deferral', 'Health insurance deferral needs a leave of one month or longer.')
  }
  const overlapping = listAllLeaves(deps.db, employee.company_id, employee.id).find(
    (other) => other.id !== selfId && other.start_date <= input.end_date && (other.actual_return_date === null ? other.end_date : addDays(other.actual_return_date as PlainDate, -1)) >= input.start_date,
  )
  if (overlapping !== undefined) throw new HrError('LEAVE_OVERLAP', 'The period overlaps another leave of absence.', { overlapping_leave_id: overlapping.id })
  return {
    reason: input.reason,
    start_date: input.start_date,
    end_date: input.end_date,
    expected_return_date: input.expected_return_date ?? addDays(input.end_date, 1),
    actual_return_date: input.actual_return_date,
    is_paid: toFlag(input.is_paid),
    paid_allowance: input.is_paid ? input.paid_allowance : null,
    include_in_service_years: toFlag(input.reason === 'parental' || input.include_in_service_years),
    nps_payment_exception: toFlag(input.nps_payment_exception),
    nhis_notice_deferral: toFlag(input.nhis_notice_deferral),
  }
}
```

`alfred-manual/04-인사/02-구성원-정보.md:84-92`

```md
> 1. 해당하는 **휴직 사유** 선택 (출산, 육아, 질병, 기타)
>
> 1. **휴직 기간(시작일·종료일)**을 입력
>
> 1. **복직 예정일** 입력
>
> 1. 아래 항목은 해당 사항이 있는 경우 버튼을 클릭하여 **[여/부]를 선택**
>
> 1. 선택된 내용을 기준으로 **4대보험 휴직 신고**가 진행
```

## 서버 이전 시 주의

- 겹침은 409 `LEAVE_OVERLAP`(`overlappingLeaveId`)로, 나머지는 422 `violations`로 돌려줍니다
- 휴직 등록·복직 시 4대보험 휴직/복직 신고를 `PENDING`으로 만듭니다

## 열린 질문

1. 현행은 첫 위반에서 멈춥니다. 재설계는 모든 위반을 한 번에 돌려줘도 될까요
2. 육아휴직 남은 일수를 사용 예정분까지 빼서 계산합니다(1년 = 365일 고정). 자녀별 한도·분할 횟수는 보지 않습니다. 볼까요
3. 건강보험 납입고지유예를 "시작일 + 1개월 ≤ 종료일 다음날"로 판정합니다. 공단 기준과 같은지 확인할까요

## 픽스처

[`apps/api/test/fixtures/rules/leave-validation.json`](../../../apps/api/test/fixtures/rules/leave-validation.json): 13건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| valid illness leave | `{"firstViolation": null, "expectedReturnDate": "2026-06-01", "includeInServiceYears": f…` |
| end before start | `{"firstViolation": "END_BEFORE_START"}` |
| starts before join | `{"firstViolation": "BEFORE_JOIN_DATE"}` |
| ends after leave date | `{"firstViolation": "AFTER_LEAVE_DATE"}` |
| paid without allowance | `{"firstViolation": "PAID_ALLOWANCE_REQUIRED"}` |
| return on start date | `{"firstViolation": "RETURN_DATE_OUT_OF_RANGE"}` |
| return the day after end | `{"firstViolation": null, "expectedReturnDate": "2026-06-01", "includeInServiceYears": f…` |
| nhis deferral on a short leave | `{"firstViolation": "DEFERRAL_NEEDS_ONE_MONTH"}` |
| nhis deferral on exactly one month | `{"firstViolation": null, "expectedReturnDate": "2026-04-01", "includeInServiceYears": f…` |
| overlaps another leave | `{"firstViolation": "LEAVE_OVERLAP"}` |
| early return frees the rest of the period | `{"firstViolation": null, "expectedReturnDate": "2026-06-01", "includeInServiceYears": f…` |
| parental leave counts toward service years | `{"firstViolation": null, "expectedReturnDate": "2026-06-01", "includeInServiceYears": t…` |
| summary while on parental leave | `{"isOnLeave": true, "currentLeaveId": "lev_a", "upcomingLeaveId": "lev_b", "totalLeaveD…` |
