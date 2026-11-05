# 근로계약 검증

## 요약

- 기간제 계약은 종료일이 필수이고 종료일은 시작일보다 앞설 수 없습니다
- 수습은 1~12개월, 지급률 90~100%이고, 계약 기간이 1년 미만이면 감액(100% 미만)할 수 없습니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/contracts/contracts.service.ts:32-60`
- `apps/api/legacy/src/modules/hr/contracts/contracts.schema.ts:1-40`
- `docs/reference/spec/hr.md:641`
- `contracts.service.ts`의 `toWorkContractWrite`
- `contracts.schema.ts`(수습 개월·지급률 범위)
- 스펙 R7

## 로직

- `contract_type = contract`이고 `end_date = null` → 거절
- `end_date < start_date` → 거절
- 수습이면 `probation_months` 필수, 지급률 기본 100
- 지급률 < 100이고 `start + 12개월 > end`이면 거절

## 근거

`apps/api/legacy/src/modules/hr/contracts/contracts.service.ts:32-45`

```ts
export function toWorkContractWrite(
  input: WorkContractInput,
  origin: { creationMethod: WorkContractRow['creation_method']; eSignRequestId: number | null } = { creationMethod: 'manual', eSignRequestId: null },
): WorkContractWrite {
  if (input.contract_type === 'contract' && input.end_date === null) throw invalidField('end_date', 'Fixed-term contracts need an end date.')
  if (input.end_date !== null && input.end_date < input.start_date) throw invalidField('end_date', 'The end date must not be before the start date.')
  if (input.has_probation && input.probation_months === null) throw invalidField('probation_months', 'Enter the probation period in months.')
  const payRate = input.has_probation ? (input.probation_pay_rate ?? 100) : null
  if (payRate !== null && payRate < 100 && input.end_date !== null && addMonths(input.start_date, 12) > input.end_date) {
    throw invalidField('probation_pay_rate', 'Contracts shorter than one year cannot reduce probation pay.')
  }
  return {
    creation_method: origin.creationMethod,
    e_sign_request_id: origin.eSignRequestId,
```

## 서버 이전 시 주의

- 지급률은 ppm 정수(`900_000` = 90%)로 받습니다
- `start + 12개월 > end` 식은 1월 1일 ~ 12월 31일 계약을 1년 미만으로 봅니다(열린 질문 1)
- 현행은 첫 위반에서 멈추고, 재설계는 위반을 모두 돌려줍니다(422 `violations`)

## 열린 질문

1. 1년 계약(2026-01-01 ~ 2026-12-31)을 "1년 미만"으로 보아 수습 감액을 막습니다. 종료일 다음날 기준으로 1년이면 허용할까요
2. 수습 지급률을 정수 퍼센트(90~100)로 받았습니다. 재설계는 ppm(900,000~1,000,000)으로 받아 소수 지급률(95.5%)도 허용할까요
3. 단순노무직종의 수습 감액 금지(최저임금법 시행령 제3조)는 직종 코드가 없어 검사하지 않습니다. 직종을 받을까요

## 픽스처

[`apps/api/test/fixtures/rules/work-contract-validation.json`](../../../apps/api/test/fixtures/rules/work-contract-validation.json): 10건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| permanent without end date | `{"firstViolation": null}` |
| fixed-term needs end date | `{"firstViolation": "END_DATE_REQUIRED"}` |
| end before start | `{"firstViolation": "END_BEFORE_START"}` |
| probation needs months | `{"firstViolation": "PROBATION_MONTHS_REQUIRED"}` |
| probation 3 months at 90% | `{"firstViolation": null}` |
| reduced probation pay on a one-year contract ending 12-31 | `{"firstViolation": "PROBATION_REDUCTION_NOT_ALLOWED"}` |
| reduced probation pay on a contract through the anniversary | `{"firstViolation": null}` |
| full probation pay on a short contract | `{"firstViolation": null}` |
| probation pay below 90% | `{"firstViolation": "PROBATION_PAY_RATE_OUT_OF_RANGE"}` |
| probation of 13 months | `{"firstViolation": "PROBATION_MONTHS_OUT_OF_RANGE"}` |
