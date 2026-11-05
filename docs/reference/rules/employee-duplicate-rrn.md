# 주민번호 중복 직원

## 요약

- 같은 회사·같은 직원 종류에서 주민번호(HMAC 해시)가 같은 직원이 있으면 등록·수정을 막습니다 (`DUPLICATE_EMPLOYEE`)
- 예외는 하나입니다. 상대가 퇴사자이고 새 직원이 재입사(`is_rejoin`)로 표시됐으면 통과합니다
- 자기 자신은 비교에서 뺍니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/employees/employees.service.ts:165-205`
- `docs/reference/spec/hr.md:636` (B:73510)
- 서비스: `resolveIdentity`, `assertNotDuplicate`
- 스펙 R2

## 로직

- 주민번호를 정규화해 해시를 만들고, 같은 해시의 직원을 찾습니다
- 찾은 직원 중 `status !== RESIGNED || !isRejoin`인 첫 직원이 막는 직원입니다. 응답에 `duplicate_employee_id`를 담습니다

## 근거

`apps/api/legacy/src/modules/hr/employees/employees.service.ts:165-205`

```ts
 * @throws {HrError} `DUPLICATE_EMPLOYEE` with `duplicate_employee_id` when another employee of the same kind has the number.
 */
export function resolveIdentity(
  deps: ServiceDeps,
  companyId: string,
  kind: EmployeeKind,
  selfId: number | null,
  input: IdentityInput,
  existing: EmployeeRow | null,
  isRejoin: boolean,
): Partial<IdentityColumns> {
  const type = input.identification_number_type ?? existing?.identification_number_type ?? 'registration'
  const raw = input.registration_number
  const result: Partial<IdentityColumns> = {}
  if (input.identification_number_type !== undefined) result.identification_number_type = type
  if (input.birth_date !== undefined) result.birth_date = input.birth_date
  if (raw !== undefined && raw !== '' && !raw.includes('*')) {
    const normalized = normalizeIdentificationNumber(raw, type)
    if (normalized === null) {
      throw invalidField('registration_number', type === 'passport' ? 'Enter a valid passport number.' : 'Enter a valid 13-digit registration number.')
    }
    const protectedNumber = protectIdentificationNumber(deps.db, deps.cipher, normalized, deps.clock.now())
    assertNotDuplicate(deps, companyId, kind, selfId, protectedNumber.hash, isRejoin)
    result.registration_number_enc = protectedNumber.encrypted
    result.registration_number_hash = protectedNumber.hash
    result.identification_number_type = type
    if (type === 'registration' && input.birth_date == null) result.birth_date = birthDateFromRegistrationNumber(normalized)
  } else if (raw === '' && existing === null) {
    throw invalidField('registration_number', 'This field is required.')
  }
  const birthDate = result.birth_date !== undefined ? result.birth_date : (existing?.birth_date ?? null)
  if (type === 'passport' && birthDate === null) throw invalidField('birth_date', 'Enter the birth date for passport holders.')
  return result
}

function assertNotDuplicate(deps: ServiceDeps, companyId: string, kind: EmployeeKind, selfId: number | null, hash: string, isRejoin: boolean): void {
  const matches = findEmployeesByRegistrationHash(deps.db, companyId, kind, hash, deps.clock.today()).filter((match) => match.id !== selfId)
  const blocking = matches.find((match) => match.status !== 'RESIGNED' || !isRejoin)
  if (blocking !== undefined) {
    throw new HrError('DUPLICATE_EMPLOYEE', 'An employee with this registration number already exists.', { duplicate_employee_id: blocking.id })
  }
```

## 서버 이전 시 주의

- 재설계는 `findBlockingDuplicate`(순수 함수)와 저장소의 해시 조회로 나눕니다. 409 `EMPLOYEE_DUPLICATE`에 `duplicateEmployeeId`를 담습니다
- 해시 키는 회사별이 아니라 서비스 전체 키입니다. 키 교체 시 재계산이 필요합니다

## 열린 질문

1. 같은 주민번호라도 직원 종류(근로·일용·사업소득·기타)가 다르면 중복으로 보지 않는데, 한 사람이 근로자이면서 사업소득자인 경우를 계속 허용할까요
2. 재입사 표시 없이 퇴사자와 같은 번호로 등록하면 막는데, 서버가 재입사를 자동으로 추정해 주는 편이 나을까요

## 픽스처

[`apps/api/test/fixtures/rules/employee-duplicate-rrn.json`](../../../apps/api/test/fixtures/rules/employee-duplicate-rrn.json): 7건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| no match | `{"blockingEmployeeId": null}` |
| active match blocks a new hire | `{"blockingEmployeeId": "emp_a"}` |
| resigned match blocks a non-rejoin | `{"blockingEmployeeId": "emp_a"}` |
| resigned match allows a rejoin | `{"blockingEmployeeId": null}` |
| active match blocks even a rejoin | `{"blockingEmployeeId": "emp_a"}` |
| editing self is not a duplicate | `{"blockingEmployeeId": null}` |
| second match blocks when the first is a resigned rejoin source | `{"blockingEmployeeId": "emp_b"}` |
