# 공제대상 가족 수

## 요약

- 간이세액표용 공제대상 가족 수 = 본인 + 연말정산 대상으로 표시된 가족 중 기준일까지 태어난 사람
- 8~20세 자녀 수는 기준 연도 − 출생 연도로 셉니다
- 비과세 보육수당 대상은 만 6세 이하 자녀·손자녀입니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/family/family.repository.ts:99-116`
- `apps/api/legacy/src/modules/hr/family/family.service.ts:23, 113-131`
- `docs/reference/spec/hr.md:655`
- `family.repository.ts`의 `countDependantsAsOf`
- `family.service.ts`의 `TAX_FREE_CHILD_MAX_AGE`
- 스펙 R21

## 로직

- SQL: `is_year_end_target = 1 AND birth_date <= date`, 자녀는 `year − 출생연도 BETWEEN 8 AND 20`

## 근거

`apps/api/legacy/src/modules/hr/family/family.repository.ts:99-116`

```ts
 * Counts an employee's deductible dependants on a date (rule R21).
 *
 * Members flagged as year-end deduction targets and born on or before the
 * date count, plus the employee. Children count toward the 8–20 bracket by
 * the year of the date minus the birth year, as the withholding table does.
 */
export function countDependantsAsOf(db: DatabaseSync, companyId: string, employeeId: number, date: PlainDate): DependantCounts {
  const year = Number(date.slice(0, 4))
  const row = queryOne<{ targets: number; children: number }>(
    db,
    `SELECT COUNT(*) AS targets,
       COALESCE(SUM(CASE WHEN relation = '자녀' AND ? - CAST(substr(birth_date, 1, 4) AS INTEGER) BETWEEN 8 AND 20 THEN 1 ELSE 0 END), 0) AS children
     FROM employee_family_members
     WHERE company_id = ? AND employee_id = ? AND is_year_end_target = 1 AND birth_date <= ?`,
    [year, companyId, employeeId, date],
  )
  return { dependents_count: 1 + (row?.targets ?? 0), children_8_to_20_count: row?.children ?? 0 }
}
```

## 서버 이전 시 주의

- 급여 컨텍스트가 `HrDirectory.countDependants`로 읽습니다

## 열린 질문

1. 8~20세 자녀를 연 나이(올해 − 출생연도)로 셉니다. 간이세액표 기준과 같은지 확인할까요
2. 비과세 보육수당 대상을 만 6세 이하로 봅니다(2024년 개정 전 기준). 개정 후 만 8세 미만 기준으로 바꿀까요

## 픽스처

[`apps/api/test/fixtures/rules/dependant-count.json`](../../../apps/api/test/fixtures/rules/dependant-count.json): 8건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| self only | `{"dependantsCount": 1, "childrenAged8To20Count": 0}` |
| spouse and two children | `{"dependantsCount": 4, "childrenAged8To20Count": 1}` |
| child aged 20 by year counts, 21 does not | `{"dependantsCount": 3, "childrenAged8To20Count": 1}` |
| non-target is ignored | `{"dependantsCount": 1, "childrenAged8To20Count": 0}` |
| unborn child is ignored | `{"dependantsCount": 1, "childrenAged8To20Count": 0}` |
| child aged 6 can be tax-free target | `true` |
| child aged 7 cannot | `false` |
| spouse cannot | `false` |
