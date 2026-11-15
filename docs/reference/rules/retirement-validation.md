# 퇴사 검증

## 요약

- 퇴사일은 중간정산일 이후, 입사일 이후여야 합니다
- 퇴사 사유는 고용보험 상실 사유 코드(11~42) 중 하나이고, 상세 사유를 주면 그 사유에 속해야 합니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/retirement/retirement.service.ts:94-110`
- `apps/api/legacy/src/modules/hr/retirement/leaving-reasons.ts:9-50`
- `manual/04-인사/02-구성원-정보.md:74-80`
- `docs/reference/spec/hr.md:651-652` (B:73855)
- `retirement.service.ts`의 `validate`
- `leaving-reasons.ts`
- 매뉴얼 구성원 정보 퇴사 절
- 스펙 R17–R18

## 로직

- 검사 순서: 중간정산일(`LEAVE_DATE_BEFORE_INTERIM`) → 입사일 → 사유
- 사유가 목록에 없거나 상세 사유가 다른 사유에 속하면 거절

## 근거

`apps/api/legacy/src/modules/hr/retirement/retirement.service.ts:94-110`

```ts
function validate(employee: EmployeeRow, input: RetirementInput): void {
  if (input.has_interim_settlement) {
    if (input.interim_settlement_date === null) throw invalidField('interim_settlement_date', 'Enter the interim settlement date.')
    if (input.interim_settlement_reason === null) throw invalidField('interim_settlement_reason', 'Choose the interim settlement reason.')
    if (input.leave_date !== null && input.leave_date < input.interim_settlement_date) {
      throw new HrError('LEAVE_DATE_BEFORE_INTERIM', 'The leave date cannot be before the interim settlement date.')
    }
  }
  if (input.leave_date !== null) {
    if (employee.join_date !== null && input.leave_date < employee.join_date) throw invalidField('leave_date', 'The leave date cannot be before the join date.')
    if (input.leaving_reason === null) throw invalidField('leaving_reason', 'Choose the leaving reason.')
  }
  if (input.leaving_reason !== null && !isValidLeavingReason(input.leaving_reason, input.leaving_detail_reason)) {
    throw invalidField('leaving_reason', 'Unknown leaving reason or detail reason.')
  }
}

```

`manual/04-인사/02-구성원-정보.md:74-80`

```md
> 1. 전달받은 사직서에 기재된 **퇴사 사유** 선택
>
> 1. 선택한 **퇴사 사유의 상세 사유**를 선택
>
> 1. 구성원의 **퇴사일자** 반영
>
> 1. 선택된 (상세) 사유는 상실신고 시에도 동일하게 적용
```

## 서버 이전 시 주의

- 재설계는 퇴사를 `:resign` 커맨드로 받고, 퇴직 정보(급여 형태·중간정산)는 하위 자원으로 둡니다
- 퇴직금 정산이 끝난 직원은 퇴사 취소·삭제를 막습니다. 정산 상태는 HR이 저장하지 않고 급여 컨텍스트에 조회 포트로 묻습니다([hr.md 열린 질문 10](../../design/hr.md#열린-질문))

## 열린 질문

1. 상세 사유 없이 사유 코드만 받아도 통과합니다. 상실신고에 상세 사유가 필요하면 필수로 바꿀까요
2. 중간정산일과 퇴사일이 같은 날이면 허용합니다. 맞습니까
3. 퇴직금 정산이 완료된 직원의 퇴사 취소·삭제를 막습니다(RETIREMENT_COMPLETED). 정산 상태는 급여 컨텍스트가 소유하는데, 이벤트로 받아도 될까요

## 픽스처

[`apps/api/test/fixtures/rules/retirement-validation.json`](../../../apps/api/test/fixtures/rules/retirement-validation.json): 7건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| valid resignation | `{"rejection": null}` |
| leave date before join | `{"rejection": "LEAVE_DATE_BEFORE_JOIN"}` |
| leave date on join date | `{"rejection": null}` |
| leave date before interim settlement | `{"rejection": "LEAVE_DATE_BEFORE_INTERIM"}` |
| unknown reason | `{"rejection": "LEAVING_REASON_INVALID"}` |
| detail of another reason | `{"rejection": "LEAVING_REASON_INVALID"}` |
| reason without detail | `{"rejection": null}` |
