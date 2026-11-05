# 연봉계약 임금 계산

## 요약

- 월급·일급·시급 계약에서 기본급, 기준시급, 통상시급, 고정수당, 최저임금 판정을 계산합니다
- 고정수당 자동계산은 통상시급 × 시간 × 가산율이고, 기본급은 월급에서 지급항목과 고정수당을 뺀 값입니다(역산)
- 가산율은 모두 1.0입니다(스펙 R10 메모: 스크린샷 값과 일치)

## 현행 위치

- `apps/api/legacy/src/modules/hr/contracts/contracts.utils.ts:60-108`
- `docs/reference/spec/hr.md:642-645, 666`
- `contracts.utils.ts`의 `calculateWage`
- 스펙 R8–R10

## 로직

- 월급 자동계산: 통상시급 = (월급 − 지급항목 + 통상임금 항목 + 상여/12) ÷ (월 소정근로시간 + Σ 고정시간 × 가산율)
- 월급 수동: 기본급 = 월급 − 지급항목 − 고정수당, 통상시급 = (기본급 + 통상임금 항목 + 상여/12) ÷ 시간
- 시급·일급: 기본급 = round(시급 × 시간), 일급의 시급 = 일급 ÷ 일 소정근로시간(기본 8)
- 최저임금 시급 = (기본급 + 최저임금 산입 항목) ÷ 시간 < 최저시급이면 미달

## 근거

`apps/api/legacy/src/modules/hr/contracts/contracts.utils.ts:60-99`

```ts
export function calculateWage(input: WageInput): WageResult {
  const enabledItems = input.paymentItems.filter((item) => item.is_enabled)
  const itemsTotal = sum(enabledItems.map((item) => item.amount))
  const ordinaryItems = sum(enabledItems.filter((item) => item.is_ordinary_wage !== false).map((item) => item.amount))
  const minimumWageItems = sum(enabledItems.filter((item) => item.counts_toward_minimum_wage !== false).map((item) => item.amount))
  const bonusMonthly = input.hasBonus && input.bonusInOrdinaryWage ? (input.bonusAmount ?? 0) / 12 : 0
  const hours = input.monthlyWorkHours
  const fixedAmounts = { overtime: 0, night: 0, holiday: 0, holiday_overtime: 0 }
  let baseSalary: number
  let ordinaryHourly: number
  if (input.wageType === 'monthly') {
    if (input.autoCalc) {
      const weightedHours = sum(FIXED_KINDS.map((kind) => (input.fixed[kind].enabled ? input.fixed[kind].hours * FIXED_ALLOWANCE_MULTIPLIER[kind] : 0)))
      ordinaryHourly = (input.amount - itemsTotal + ordinaryItems + bonusMonthly) / (hours + weightedHours)
      for (const kind of FIXED_KINDS) {
        if (input.fixed[kind].enabled) fixedAmounts[kind] = Math.round(ordinaryHourly * input.fixed[kind].hours * FIXED_ALLOWANCE_MULTIPLIER[kind])
      }
      baseSalary = input.amount - itemsTotal - sum(Object.values(fixedAmounts))
    } else {
      for (const kind of FIXED_KINDS) if (input.fixed[kind].enabled) fixedAmounts[kind] = input.fixed[kind].amount
      baseSalary = input.amount - itemsTotal - sum(Object.values(fixedAmounts))
      ordinaryHourly = (baseSalary + ordinaryItems + bonusMonthly) / hours
    }
  } else {
    const hourly = input.wageType === 'hourly' ? input.amount : input.amount / (input.dailyWorkHours ?? 8)
    baseSalary = Math.round(hourly * hours)
    ordinaryHourly = hourly + (ordinaryItems + bonusMonthly) / hours
  }
  const baseHourly = baseSalary / hours
  const minimumWageHourly = (baseSalary + minimumWageItems) / hours
  return {
    baseSalary,
    baseHourlyWage: round2(baseHourly),
    ordinaryHourlyWage: round2(ordinaryHourly),
    probationHourlyWage: input.probationPayRate === null ? null : round2((baseHourly * input.probationPayRate) / 100),
    fixedAmounts,
    minimumWageHourly: round2(minimumWageHourly),
    isBelowMinimumWage: minimumWageHourly < MINIMUM_HOURLY_WAGE_2026,
  }
}
```

## 서버 이전 시 주의

- 시급 값은 소수 둘째 자리 반올림, 금액은 원 단위 반올림입니다. 서버는 같은 순서로 반올림해야 같은 값이 나옵니다
- 최저시급은 입력(`minimumHourlyWage`)으로 받아 연도별 참조데이터로 옮길 수 있게 했습니다

## 열린 질문

1. 고정연장·야간·휴일 가산율이 모두 1.0입니다(spec R10은 1.5/0.5/1.5/2.0). 스크린샷 값은 1.0과 맞습니다. 법정 가산율로 바꿀까요
2. 최저시급(2026년 10,320원)을 상수로 두었습니다. 연도별 참조데이터로 옮길까요
3. 수습 기준시급만 계산하고 수습 기간 최저임금 판정(90%)은 하지 않습니다. 판정에 넣을까요

## 픽스처

[`apps/api/test/fixtures/rules/payroll-contract-wage.json`](../../../apps/api/test/fixtures/rules/payroll-contract-wage.json): 11건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| monthly 3,000,000 over 209h | `{"baseSalary": 3000000, "baseHourlyWage": 14354.07, "ordinaryHourlyWage": 14354.07, "fi…` |
| monthly at the 2026 minimum | `{"baseSalary": 2156880, "baseHourlyWage": 10320, "ordinaryHourlyWage": 10320, "fixedAll…` |
| monthly one won below minimum | `{"baseSalary": 2156879, "baseHourlyWage": 10320, "ordinaryHourlyWage": 10320, "fixedAll…` |
| meal allowance excluded from minimum wage | `{"baseSalary": 2156880, "baseHourlyWage": 10320, "ordinaryHourlyWage": 11276.94, "fixed…` |
| disabled payment item is ignored | `{"baseSalary": 3000000, "baseHourlyWage": 14354.07, "ordinaryHourlyWage": 14354.07, "fi…` |
| bonus in ordinary wage raises ordinary hourly | `{"baseSalary": 3000000, "baseHourlyWage": 14354.07, "ordinaryHourlyWage": 15311, "fixed…` |
| auto fixed overtime 30h and night 5h | `{"baseSalary": 4496926, "baseHourlyWage": 21516.39, "ordinaryHourlyWage": 21516.39, "fi…` |
| manual fixed overtime | `{"baseSalary": 2700000, "baseHourlyWage": 12918.66, "ordinaryHourlyWage": 12918.66, "fi…` |
| hourly 10,320 | `{"baseSalary": 2156880, "baseHourlyWage": 10320, "ordinaryHourlyWage": 10320, "fixedAll…` |
| daily 82,560 over 8h | `{"baseSalary": 2156880, "baseHourlyWage": 10320, "ordinaryHourlyWage": 10320, "fixedAll…` |
| probation at 90% | `{"baseSalary": 3000000, "baseHourlyWage": 14354.07, "ordinaryHourlyWage": 14354.07, "pr…` |
