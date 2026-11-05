# 직원 경고(계약 만료·무기계약 전환)

## 요약

- 직원 목록 ▲ 아이콘 뒤의 경고 목록입니다
- 근로소득자인데 주민번호 없음, 기간제 계약 만료 임박(N일 이내)·만료(갱신 없음), 무기계약 전환 대상
- 퇴사자는 주민번호 경고만 남습니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/employees/employees.utils.ts:49-64`
- `apps/api/legacy/src/modules/hr/employees/employee-view.sql.ts:25-47`
- `docs/reference/spec/hr.md:639`
- `employees.utils.ts`의 `employeeWarnings`
- 직원 뷰 SQL의 현재 계약·`contract_followed` 계산
- 스펙 R5

## 로직

- 현재 계약은 시작한 계약 중 가장 늦게 시작한 것, 없으면 가장 먼저 시작할 계약입니다
- `end < today`이고 그 뒤에 시작하는 계약이 없으면 `contract_expired`
- `today ≤ end ≤ today + N`이면 `contract_expiring_soon` (N = 30)

## 근거

`apps/api/legacy/src/modules/hr/employees/employees.utils.ts:49-64`

```ts
/**
 * Lists the warnings behind an employee's ▲ icon.
 *
 * @param indefiniteTarget Whether the employee's fixed-term contracts exceed or approach two years.
 * @param warningDays Days before a contract end that count as expiring soon.
 */
export function employeeWarnings(view: EmployeeView, today: PlainDate, indefiniteTarget: boolean, warningDays: number): EmployeeWarning[] {
  const warnings: EmployeeWarning[] = []
  if (view.kind === 'wage-salary' && view.registration_number_enc === null) warnings.push('missing_required_info')
  if (view.status !== 'RESIGNED' && view.contract_type === 'contract' && view.contract_end_date !== null) {
    if (view.contract_end_date < today && view.contract_followed === 0) warnings.push('contract_expired')
    else if (view.contract_end_date >= today && view.contract_end_date <= addDays(today, warningDays)) warnings.push('contract_expiring_soon')
  }
  if (view.status !== 'RESIGNED' && indefiniteTarget) warnings.push('indefinite_conversion_target')
  return warnings
}
```

`apps/api/legacy/src/modules/hr/employees/employee-view.sql.ts:25-47`

```ts
    (
      SELECT w.id FROM employee_work_contracts w
      WHERE w.company_id = e.company_id AND w.employee_id = e.id
      ORDER BY CASE WHEN w.start_date <= ?2 THEN 0 ELSE 1 END,
               CASE WHEN w.start_date <= ?2 THEN w.start_date END DESC,
               w.start_date, w.id DESC
      LIMIT 1
    ) AS current_contract_id
  FROM employees e
  LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
  LEFT JOIN positions p ON p.company_id = e.company_id AND p.id = e.position_id
  LEFT JOIN employee_retirement_infos r ON r.company_id = e.company_id AND r.employee_id = e.id
  LEFT JOIN employee_non_wage_details n ON n.company_id = e.company_id AND n.employee_id = e.id
  WHERE e.company_id = ?1
),
employee_view AS (
  SELECT base.*,
    c.contract_type AS contract_type,
    c.end_date AS contract_end_date,
    CASE WHEN c.end_date IS NOT NULL AND EXISTS (
      SELECT 1 FROM employee_work_contracts later
      WHERE later.company_id = base.company_id AND later.employee_id = base.id AND later.start_date > c.end_date
    ) THEN 1 ELSE 0 END AS contract_followed
```

## 서버 이전 시 주의

- 경고 코드는 대문자로 바꿉니다: `MISSING_REGISTRATION_NUMBER`, `CONTRACT_EXPIRING_SOON`, `CONTRACT_EXPIRED`, `INDEFINITE_CONVERSION_TARGET`
- 스펙은 N을 확인하지 못했습니다. 30일을 기본값으로 둡니다

## 열린 질문

1. 경고 기간 N을 30일로 고정했는데(spec "N 미확인"), 회사 설정으로 둘까요
2. 갱신 계약이 만료일 다음날이 아니라 공백을 두고 시작해도 "갱신 있음"으로 보는데, 공백 기간을 경고할까요
3. 계약이 끝난 날(종료일 당일)은 만료 임박으로 보고 다음날부터 만료입니다. 맞습니까

## 픽스처

[`apps/api/test/fixtures/rules/contract-expiry-warning.json`](../../../apps/api/test/fixtures/rules/contract-expiry-warning.json): 9건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| wage employee without registration number | `["MISSING_REGISTRATION_NUMBER"]` |
| business income earner without registration number has no warning | `[]` |
| fixed-term ends in 30 days | `["CONTRACT_EXPIRING_SOON"]` |
| fixed-term ends in 31 days | `[]` |
| fixed-term ends today is expiring not expired | `["CONTRACT_EXPIRING_SOON"]` |
| expired without renewal | `["CONTRACT_EXPIRED"]` |
| expired but renewal starts later is not flagged | `[]` |
| permanent contract never warns | `["INDEFINITE_CONVERSION_TARGET"]` |
| resigned employee only keeps registration warning | `["MISSING_REGISTRATION_NUMBER"]` |
