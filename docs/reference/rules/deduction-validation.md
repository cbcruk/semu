# 원천징수 설정 검증

## 요약

- 직접 입력 방식이면 소득세 금액 필수, 소득세 조정비율은 80·100·120%
- 소득세 감면은 유형별 사유·적용 방식·기간(법정 연수 이내)·비율(그 유형 사유들의 비율 중 하나)이 필요합니다
- 학자금 상환은 월 금액과 시작일이 필요합니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/deduction/deduction.utils.ts:13-45`
- `apps/api/legacy/src/modules/hr/deduction/deduction.schema.ts:8, 14`
- `docs/reference/spec/hr.md:653-654`
- `deduction.utils.ts`의 `toDeductionWrite`
- `deduction.schema.ts`(조정비율)
- 스펙 R19–R20

## 로직

- 사유가 없으면 그 유형의 사유가 하나뿐일 때 그것을 씁니다
- 종료일 ≤ 시작일 + 연수 × 12개월 − 1일
- 비율이 없으면 사유 비율을 씁니다

## 근거

`apps/api/legacy/src/modules/hr/deduction/deduction.utils.ts:13-45`

```ts
export function toDeductionWrite(input: DeductionInput): DeductionInfoWrite {
  if (input.income_tax_calc_method === 'manual_input' && input.manual_income_tax === null) {
    throw invalidField('manual_income_tax', 'Enter the income tax amount.')
  }
  const reducing = input.income_tax_reduction_type !== 'none'
  let reasonCode: string | null = null
  let rate: number | null = null
  if (reducing) {
    const reasons = INCOME_TAX_REDUCTION_REASONS.filter((reason) => reason.type === input.income_tax_reduction_type)
    const reason = reasons.find((candidate) => candidate.code === input.income_tax_reduction_reason) ?? (reasons.length === 1 ? reasons[0] : undefined)
    if (reason === undefined) throw invalidField('income_tax_reduction_reason', 'Choose a reduction reason of this type.')
    if (input.income_tax_reduction_application_type === '') throw invalidField('income_tax_reduction_application_type', 'Choose how the reduction is applied.')
    const start = input.income_tax_reduction_start_date
    const end = input.income_tax_reduction_end_date
    if (start === null || end === null) throw invalidField('income_tax_reduction_start_date', 'Enter the reduction period.')
    if (end < start) throw invalidField('income_tax_reduction_end_date', 'The end date must not be before the start date.')
    if (end > addDays(addMonths(start, reason.period_years * 12), -1)) {
      throw invalidField('income_tax_reduction_end_date', `The reduction lasts at most ${reason.period_years} years.`)
    }
    const allowedRates = reasons.map((candidate) => candidate.rate)
    if (input.income_tax_reduction_rate !== null && !allowedRates.includes(input.income_tax_reduction_rate)) {
      throw invalidField('income_tax_reduction_rate', `Use one of ${allowedRates.join(', ')}.`)
    }
    reasonCode = reason.code
    rate = input.income_tax_reduction_rate ?? reason.rate
  }
  if (input.student_loan_applied && (input.student_loan_monthly_amount === null || input.student_loan_start_date === null)) {
    throw invalidField('student_loan_monthly_amount', 'Enter the monthly repayment and its start date.')
  }
  return {
    income_tax_calc_method: input.income_tax_calc_method,
    manual_income_tax: input.income_tax_calc_method === 'manual_input' ? input.manual_income_tax : null,
    income_tax_rate: input.income_tax_rate,
```

## 서버 이전 시 주의

- 비율은 ppm 정수로 받습니다(`1_000_000` = 100%)
- 재설계는 `tax-withholding` 하위 자원으로 이름을 바꿉니다

## 열린 질문

1. 감면율을 같은 유형의 다른 사유 비율(청년 사유에 70%)로도 받습니다. 사유별 비율만 받을까요
2. 연 200만원 감면 한도는 저장만 하고 급여 계산이 적용합니다. 급여 컨텍스트가 이 값을 읽어 가면 될까요
3. 외국인 기술자 특화선도(3년 70% + 7년 50%)는 기간에 따라 비율이 바뀌는데 한 비율만 저장합니다. 구간을 둘까요

## 픽스처

[`apps/api/test/fixtures/rules/deduction-validation.json`](../../../apps/api/test/fixtures/rules/deduction-validation.json): 9건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| tax table at 100% | `{"firstViolation": null, "reduction": null}` |
| manual without amount | `{"firstViolation": "REQUIRED", "reduction": null}` |
| adjustment rate 90% | `{"firstViolation": "ADJUSTMENT_RATE_NOT_ALLOWED", "reduction": null}` |
| youth reduction 5 years | `{"firstViolation": null, "reduction": {"reasonCode": "YOUTH", "ratePpm": 900000}}` |
| youth reduction one day too long | `{"firstViolation": "REDUCTION_PERIOD_TOO_LONG", "reduction": null}` |
| small business without reason | `{"firstViolation": "REDUCTION_REASON_REQUIRED", "reduction": null}` |
| single-reason type fills the reason | `{"firstViolation": null, "reduction": {"reasonCode": "RETURNING_TALENT", "ratePpm": 500…` |
| rate of another reason in the type is allowed | `{"firstViolation": null, "reduction": {"reasonCode": "YOUTH", "ratePpm": 700000}}` |
| student loan without start date | `{"firstViolation": "STUDENT_LOAN_INCOMPLETE", "reduction": null}` |
