import type { FixedAllowanceKind, WageInput, WageResult } from './wage-calculation.types.ts'

/**
 * 2026년 최저시급(원)입니다. Payroll 기준표가 연결되기 전까지 기본값으로 씁니다.
 *
 * 출처: 고용노동부고시 제2025-47호(2025. 8. 5.) 2026년 적용 최저임금, 시간급 10,320원.
 * https://www.minimumwage.go.kr/minWage/policy/decisionMain.do
 */
export const MINIMUM_HOURLY_WAGE_2026 = 10_320

const FIXED_KINDS: ReadonlyArray<FixedAllowanceKind> = ['overtime', 'night', 'holiday', 'holidayOvertime']

/**
 * 고정 수당 1시간에 곱하는 통상시급 배율입니다.
 *
 * 화면 값이 가산 없이 `통상시급 × 시간`이라(spec R10 검증 메모) 모두 1.0입니다. Payroll과 맞출 때까지 바꾸지 않습니다.
 */
export const FIXED_ALLOWANCE_MULTIPLIER: Record<FixedAllowanceKind, number> = {
  overtime: 1,
  night: 1,
  holiday: 1,
  holidayOvertime: 1,
}

/**
 * 급여계약 입력에서 기본급·기준시급·통상시급·수습시급·고정수당과 최저임금 판정을 계산합니다.
 *
 * 월급 + 자동계산이면 통상시급과 고정수당이 서로에 기대므로, `A` 월급, `P` 켜진 지급항목 합,
 * `Pₒ` 그중 통상임금, `B` 통상임금에 넣는 연 상여, `M` 월 소정근로시간, `H` 배율을 곱한 고정 시간으로
 * `o = (A − P + Pₒ + B/12) / (M + H)`를 풉니다. 기본급은 `A − P − 고정수당`입니다.
 * 일급·시급은 시급 × 월 소정근로시간을 기본급으로 봅니다.
 *
 * @example 월 300만원, 고정연장 10시간 자동계산
 * ```ts
 * const result = calculateWage({ wageType: 'MONTHLY', amount: 3_000_000, monthlyWorkHours: 209, ... })
 * result.baseSalary + result.fixedAllowanceAmounts.overtime // 3_000_000
 * ```
 */
export function calculateWage(input: WageInput): WageResult {
  const enabled = input.paymentItems.filter((item) => item.enabled)
  const itemsTotal = sum(enabled.map((item) => item.amount))
  const ordinaryItems = sum(enabled.filter((item) => item.ordinaryWage !== false).map((item) => item.amount))
  const minimumWageItems = sum(
    enabled.filter((item) => item.countsTowardMinimumWage !== false).map((item) => item.amount),
  )
  const bonusMonthly = input.bonus?.inOrdinaryWage === true ? input.bonus.amount / 12 : 0
  const hours = input.monthlyWorkHours
  const fixed: Record<FixedAllowanceKind, number> = { overtime: 0, night: 0, holiday: 0, holidayOvertime: 0 }
  let baseSalary: number
  let ordinaryHourly: number
  if (input.wageType === 'MONTHLY') {
    if (input.fixedAllowanceAutoCalc) {
      const weightedHours = sum(
        FIXED_KINDS.map((kind) =>
          input.fixedAllowances[kind].enabled
            ? input.fixedAllowances[kind].hours * FIXED_ALLOWANCE_MULTIPLIER[kind]
            : 0,
        ),
      )
      ordinaryHourly = (input.amount - itemsTotal + ordinaryItems + bonusMonthly) / (hours + weightedHours)
      for (const kind of FIXED_KINDS) {
        const allowance = input.fixedAllowances[kind]
        if (allowance.enabled)
          fixed[kind] = Math.round(ordinaryHourly * allowance.hours * FIXED_ALLOWANCE_MULTIPLIER[kind])
      }
      baseSalary = input.amount - itemsTotal - sum(Object.values(fixed))
    } else {
      for (const kind of FIXED_KINDS)
        if (input.fixedAllowances[kind].enabled) fixed[kind] = input.fixedAllowances[kind].amount
      baseSalary = input.amount - itemsTotal - sum(Object.values(fixed))
      ordinaryHourly = (baseSalary + ordinaryItems + bonusMonthly) / hours
    }
  } else {
    const hourly = input.wageType === 'HOURLY' ? input.amount : input.amount / (input.dailyWorkHours ?? 8)
    baseSalary = Math.round(hourly * hours)
    ordinaryHourly = hourly + (ordinaryItems + bonusMonthly) / hours
  }
  const baseHourly = baseSalary / hours
  const minimumWageHourly = (baseSalary + minimumWageItems) / hours
  return {
    baseSalary,
    baseHourlyWage: round2(baseHourly),
    ordinaryHourlyWage: round2(ordinaryHourly),
    ...(input.probationPayRatePpm === undefined
      ? {}
      : { probationHourlyWage: round2((baseHourly * input.probationPayRatePpm) / 1_000_000) }),
    fixedAllowanceAmounts: fixed,
    minimumWageHourly: round2(minimumWageHourly),
    isBelowMinimumWage: minimumWageHourly < input.minimumHourlyWage,
  }
}

function sum(values: ReadonlyArray<number>): number {
  return values.reduce((total, value) => total + value, 0)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
