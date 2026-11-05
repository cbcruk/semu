# 직원 상태 파생

## 요약

- 상태는 저장하지 않고 날짜로 계산합니다: `RESIGNED` > `PRE_JOINED` > `LEAVE` > `JOINED` 순서
- 퇴사일 당일은 재직이고 다음날부터 퇴사입니다
- 휴직은 시작일부터 종료일(조기 복직 시 복직일 전날)까지입니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/employees/employee-view.sql.ts:15-24`
- 직원 뷰 SQL의 `CASE` 식

## 로직

- `leave_date < asOf`이면 `RESIGNED`
- `join_date > asOf`이면 `PRE_JOINED`
- `start_date ≤ asOf < COALESCE(actual_return_date, end_date + 1)`인 휴직이 있으면 `LEAVE`
- 그 밖에는 `JOINED` (입사일이 없어도 `JOINED`)

## 근거

`apps/api/legacy/src/modules/hr/employees/employee-view.sql.ts:15-24`

```ts
    CASE
      WHEN COALESCE(r.leave_date, n.leave_date) IS NOT NULL AND COALESCE(r.leave_date, n.leave_date) < ?2 THEN 'RESIGNED'
      WHEN e.join_date IS NOT NULL AND e.join_date > ?2 THEN 'PRE_JOINED'
      WHEN EXISTS (
        SELECT 1 FROM employee_leaves l
        WHERE l.company_id = e.company_id AND l.employee_id = e.id AND l.start_date <= ?2
          AND ?2 < COALESCE(l.actual_return_date, date(l.end_date, '+1 day'))
      ) THEN 'LEAVE'
      ELSE 'JOINED'
    END AS status,
```

## 서버 이전 시 주의

- 서버 이전 후에도 상태를 컬럼으로 저장하지 않습니다. 목록 필터는 기준일(`asOf`)을 받아 같은 식으로 계산합니다
- 퇴사일은 퇴직 정보(`retirement`)와 직원 행 두 곳에 있었습니다(`COALESCE(r.leave_date, n.leave_date)`). 재설계는 직원 집합체 하나에 둡니다

## 열린 질문

1. 퇴사일 당일을 재직으로 보는데(퇴사일 다음날부터 RESIGNED), 화면 문구와 4대보험 상실일(퇴사일 다음날)과 맞는지 확인할까요
2. 입사일이 없는 직원을 재직으로 보는데, 입사일을 필수로 바꾸면 이 경우가 없어집니다. 필수로 할까요

## 픽스처

[`apps/api/test/fixtures/rules/employee-status.json`](../../../apps/api/test/fixtures/rules/employee-status.json): 9건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| before join date | `"PRE_JOINED"` |
| on join date | `"JOINED"` |
| no join date counts as joined | `"JOINED"` |
| on leave date still joined | `"JOINED"` |
| day after leave date resigned | `"RESIGNED"` |
| inside leave period | `"LEAVE"` |
| day after leave end | `"JOINED"` |
| early return ends leave on return date | `"JOINED"` |
| resignation wins over leave | `"RESIGNED"` |
