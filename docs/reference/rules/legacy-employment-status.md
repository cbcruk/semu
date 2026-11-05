# 현행 재직 상태(한글)

## 요약

- 현행 직원 목록의 `employment_status`(재직·휴직·퇴사·임시저장·입사처리중·휴직처리중·퇴사처리중)를 만드는 규칙입니다
- 주민번호가 없으면 임시저장, 열린 4대보험 신고가 있으면 처리중(상실 > 휴직 > 취득), 그 밖에는 파생 상태를 옮깁니다
- 입사 전 직원도 재직으로 보입니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/legacy/legacy.utils.ts:4-31`
- `legacy.utils.ts`의 `legacyEmploymentStatus`

## 로직

- `registration_number_enc === null` → 임시저장
- 대기 중 신고 종류: `leave`(상실) → 퇴사처리중, `leave_of_absence` → 휴직처리중, `join` → 입사처리중
- `LEAVE` → 휴직, `RESIGNED` → 퇴사, 나머지 → 재직

## 근거

`apps/api/legacy/src/modules/hr/legacy/legacy.utils.ts:4-31`

```ts
/** Korean employment status of the legacy 직원 관리 list. */
export type LegacyEmploymentStatus = '재직' | '휴직' | '퇴사' | '임시저장' | '입사처리중' | '퇴사처리중' | '휴직처리중'

/**
 * Derives the legacy `employment_status` of an employee (state machine §3.2).
 *
 * An employee without a registration number is 임시저장. An open 4대보험
 * report turns the status into its 처리중 form, a resignation report taking
 * precedence over a leave report and a leave report over a join report.
 * Otherwise the computed status maps to 재직, 휴직 or 퇴사; employees who
 * have not joined yet count as 재직, as the legacy list has no such state.
 *
 * @param pendingKinds Kinds of the employee's 4대보험 reports still pending.
 */
export function legacyEmploymentStatus(view: Pick<EmployeeView, 'registration_number_enc' | 'status'>, pendingKinds: ReadonlySet<InsuranceFilingKind>): LegacyEmploymentStatus {
  if (view.registration_number_enc === null) return '임시저장'
  if (pendingKinds.has('leave')) return '퇴사처리중'
  if (pendingKinds.has('leave_of_absence')) return '휴직처리중'
  if (pendingKinds.has('join')) return '입사처리중'
  switch (view.status) {
    case 'LEAVE':
      return '휴직'
    case 'RESIGNED':
      return '퇴사'
    default:
      return '재직'
  }
}
```

## 서버 이전 시 주의

- 재설계 API는 이 값을 내보내지 않습니다. `status`, `warnings`(`MISSING_REGISTRATION_NUMBER`), 직원별 `insuranceFilings`로 나눠 보여 줍니다
- 이관 때는 처리중 상태를 `PENDING` 신고로 옮깁니다(`migrateLegacyEmploymentStatus`)

## 열린 질문

1. 재설계는 이 상태를 저장하지 않고 status·warnings·insuranceFilings로 나눕니다. 이관 때 처리중 상태를 열린 신고(PENDING)로 옮기면 될까요
2. 입사 전 직원이 현행 목록에서 재직으로 보이는 것을 재설계 PRE_JOINED로 바꿔도 될까요

## 픽스처

[`apps/api/test/fixtures/rules/legacy-employment-status.json`](../../../apps/api/test/fixtures/rules/legacy-employment-status.json): 7건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| no registration number is 임시저장 | `"임시저장"` |
| pending loss wins | `"퇴사처리중"` |
| pending leave over join | `"휴직처리중"` |
| pending join | `"입사처리중"` |
| on leave | `"휴직"` |
| resigned | `"퇴사"` |
| pre-joined shows as 재직 | `"재직"` |
