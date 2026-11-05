# 무기계약 전환 알림

## 요약

- 기간제 계약을 공백 없이 이어진 체인으로 묶어, 체인 시작 + 24개월(전환일)에 닿았거나 90일 안에 닿을 예정이면 대상입니다
- 체인 시작일에 만 55세 이상이면 예외입니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/contracts/contracts.utils.ts:10-18, 110-155`
- `docs/reference/spec/hr.md:640`
- `contracts.utils.ts`의 `indefiniteConversionAlert`
- 스펙 R6

## 로직

- 종료일 있는 기간제 계약만 시작일 순으로 정렬하고, 마지막 계약에서 거꾸로 `이전 종료일 + 1 ≥ 현재 체인 시작`이면 잇습니다
- `chainEnd ≥ 전환일` → `exceeded`, `chainEnd ≥ today`이고 전환일까지 90일 이하 → `approaching`, 그 밖에 `none`
- `is_target = !exempt && status ≠ none`

## 근거

`apps/api/legacy/src/modules/hr/contracts/contracts.utils.ts:110-155`

```ts
export function indefiniteConversionAlert(
  contracts: readonly Pick<WorkContractRow, 'contract_type' | 'start_date' | 'end_date'>[],
  birthDate: string | null,
  today: PlainDate,
): IndefiniteConversionAlert {
  const fixedTerm = contracts
    .filter((contract) => contract.contract_type === 'contract' && contract.end_date !== null)
    .map((contract) => ({ start: contract.start_date as PlainDate, end: contract.end_date as PlainDate }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const empty: IndefiniteConversionAlert = {
    is_target: false,
    status: 'none',
    is_exempt: false,
    exempt_reason: null,
    chain_start_date: null,
    chain_end_date: null,
    total_contract_days: 0,
    conversion_date: null,
    days_until_conversion: null,
  }
  const last = fixedTerm.at(-1)
  if (last === undefined) return empty
  let chainStart = last.start
  let chainEnd = last.end
  for (let index = fixedTerm.length - 2; index >= 0; index -= 1) {
    const previous = fixedTerm[index]
    if (previous === undefined || addDays(previous.end, 1) < chainStart) break
    chainStart = previous.start < chainStart ? previous.start : chainStart
    chainEnd = previous.end > chainEnd ? previous.end : chainEnd
  }
  const conversionDate = addMonths(chainStart, 24)
  const exempt = birthDate !== null && ageOn(birthDate, chainStart) >= 55
  const daysUntil = daysBetween(today, conversionDate)
  const status = chainEnd >= conversionDate ? 'exceeded' : chainEnd >= today && daysUntil <= INDEFINITE_CONVERSION_NOTICE_DAYS ? 'approaching' : 'none'
  return {
    is_target: !exempt && status !== 'none',
    status,
    is_exempt: exempt,
    exempt_reason: exempt ? 'aged_55_or_over' : null,
    chain_start_date: chainStart,
    chain_end_date: chainEnd,
    total_contract_days: daysBetween(chainStart, chainEnd) + 1,
    conversion_date: conversionDate,
    days_until_conversion: daysUntil,
  }
}
```

## 서버 이전 시 주의

- 55세 외 예외(전문자격, 휴직 대체 등)는 입력이 없어 판정하지 않습니다
- 직원 경고 `INDEFINITE_CONVERSION_TARGET`이 이 결과를 씁니다

## 열린 질문

1. "2년 초과"를 체인 종료일 ≥ 시작일 + 24개월로 봅니다. 2년째 되는 날 하루만 넘어도 전환되는지(기간제법 제4조) 확인할까요
2. 55세 외 예외(전문자격, 휴직 대체, 정부 일자리 등)는 입력이 없어 판정하지 않습니다. 예외 사유를 계약에 받을까요
3. 알림 시작을 전환일 90일 전으로 두었습니다. 회사 설정으로 둘까요

## 픽스처

[`apps/api/test/fixtures/rules/indefinite-conversion-alert.json`](../../../apps/api/test/fixtures/rules/indefinite-conversion-alert.json): 7건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| no fixed-term contract | `{"isTarget": false, "status": "NONE", "isExempt": false, "conversionDate": null}` |
| single one-year contract | `{"isTarget": false, "status": "NONE", "isExempt": false, "conversionDate": "2028-01-01"}` |
| renewed chain reaches two years | `{"isTarget": true, "status": "EXCEEDED", "isExempt": false, "conversionDate": "2026-07-…` |
| chain ends the day before two years but conversion is within 90 days | `{"isTarget": true, "status": "APPROACHING", "isExempt": false, "conversionDate": "2026-…` |
| gap breaks the chain | `{"isTarget": false, "status": "NONE", "isExempt": false, "conversionDate": "2027-07-01"}` |
| aged 55 at chain start is exempt | `{"isTarget": false, "status": "EXCEEDED", "isExempt": true, "conversionDate": "2026-07-…` |
| chain already ended before today and short of two years | `{"isTarget": false, "status": "NONE", "isExempt": false, "conversionDate": "2026-09-01"}` |
