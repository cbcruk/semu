# 부서·직위 사용 중

## 요약

- 한 번이라도 배정된 부서·직위는 지울 수 없습니다 (`DEPARTMENT_IN_USE`, `POSITION_IN_USE`)
- 이름은 회사 안에서 앞뒤 공백을 빼고 유일합니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/organization/organization.repository.ts:18-74`
- `manual/04-인사/02-구성원-정보.md:30`
- `docs/reference/spec/hr.md:638`
- `organization.repository.ts`의 `isOrganizationUnitUsed`, `replaceOrganizationUnits`
- 매뉴얼 구성원 정보
- 스펙 R4

## 로직

- `is_used` 플래그(한 번 배정되면 켜짐)가 있거나 현재 그 단위를 가리키는 직원이 있으면 사용 중
- 현행은 목록 전체를 바꾸는(PUT) 방식이라 빠진 단위를 지우려다 거절됩니다

## 근거

`apps/api/legacy/src/modules/hr/organization/organization.repository.ts:18-34`

```ts

/** Tells whether a unit was ever assigned, through its flag or a current employee reference. */
export function isOrganizationUnitUsed(db: DatabaseSync, table: OrganizationTable, row: OrganizationUnitRow): boolean {
  if (row.is_used === 1) return true
  const reference = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM employees WHERE company_id = ? AND ${REFERENCE_COLUMN[table]} = ?`, [row.company_id, row.id])
  return (reference?.n ?? 0) > 0
}

/**
 * Replaces a company's departments or positions with the given list (rule R4).
 *
 * Entries with an `id` are renamed, entries without one are created, and
 * units left out are deleted. The list order becomes the display order.
 *
 * @throws {HrError} `DEPARTMENT_IN_USE` or `POSITION_IN_USE` when a left-out unit was ever assigned.
 * @throws {DomainError} `VALIDATION_FAILED` for unknown IDs or duplicate names.
 */
```

`manual/04-인사/02-구성원-정보.md:30-30`

```md
단, 한 번 설정하여 사용된 부서 및 직위는 삭제할 수 없습니다.
```

## 서버 이전 시 주의

- 재설계는 단위별 CRUD와 `:reorder`로 나눕니다. 삭제만 409로 막습니다

## 열린 질문

1. "한 번이라도 쓰인" 판정을 과거 발령 이력까지 보는데, 이력만 있는 부서를 숨기기(비활성)로 대신할까요
2. 이름 중복을 대소문자·공백 차이로도 막을까요(현행은 앞뒤 공백만 무시)

## 픽스처

[`apps/api/test/fixtures/rules/organization-unit-in-use.json`](../../../apps/api/test/fixtures/rules/organization-unit-in-use.json): 6건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| never assigned | `false` |
| currently assigned | `true` |
| assigned in the past only | `true` |
| same name taken | `true` |
| same name after trim | `true` |
| renaming self | `false` |
