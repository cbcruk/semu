import type { PremiumMultipliers } from '../../payroll/payroll.public.ts'
import type { FixedAllowanceKind, WageInput, WageResult } from './wage-calculation.types.ts'

/**
 * 2026년 최저시급(원)입니다. Payroll 기준표가 연결되기 전까지 기본값으로 씁니다.
 *
 * 출처: 고용노동부고시 제2025-47호(2025. 8. 5.) 2026년 적용 최저임금, 시간급 10,320원.
 * https://www.minimumwage.go.kr/minWage/policy/decisionMain.do
 */
export const MINIMUM_HOURLY_WAGE_2026 = 10_320

const 고정수당종류: ReadonlyArray<FixedAllowanceKind> = ['overtime', 'night', 'holiday', 'holidayOvertime']

/**
 * 고정수당 종류마다 1시간에 곱하는 통상시급 배율입니다. Payroll 지급배수(ppm)를 배율로 바꿉니다.
 *
 * 상시 5명 이상이면 근로기준법 제56조의 가산(연장·야간·휴일 50%, 휴일 8시간 초과 100%)을 넣은 연장 1.5, 야간 0.5(가산분),
 * 휴일 1.5, 휴일연장 2이고, 4명 이하면 제56조가 적용되지 않아(제11조 ②, 시행령 제7조 별표 1) 연장·휴일·휴일연장 1, 야간 0입니다.
 */
function 지급배율(multipliers: PremiumMultipliers, kind: FixedAllowanceKind): number {
  const 지급배수ppm: Record<FixedAllowanceKind, number> = {
    overtime: multipliers.overtimeRatePpm,
    night: multipliers.nightRatePpm,
    holiday: multipliers.holidayRatePpm,
    holidayOvertime: multipliers.holidayOvertimeRatePpm,
  }
  return 지급배수ppm[kind] / 1_000_000
}

/**
 * 급여계약 입력에서 기본급·기준시급·통상시급·수습시급·고정수당과 최저임금 판정을 계산합니다.
 *
 * 월급 + 자동계산이면 통상시급과 고정수당이 서로에 기대므로, `A` 월급, `P` 켜진 지급항목 합,
 * `Pₒ` 그중 통상임금, `B` 통상임금에 넣는 연 상여, `M` 월 소정근로시간, `H` 지급배율(`premiumMultipliers`)을 곱한 고정 시간으로
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
  const 켜진지급항목 = input.paymentItems.filter((item) => item.enabled)
  const 지급항목합계 = sum(켜진지급항목.map((item) => item.amount))
  const 통상임금항목합계 = sum(켜진지급항목.filter((item) => item.ordinaryWage !== false).map((item) => item.amount))
  const 최저임금산입항목합계 = sum(
    켜진지급항목.filter((item) => item.countsTowardMinimumWage !== false).map((item) => item.amount),
  )
  const 통상임금상여월할액 = input.bonus?.inOrdinaryWage === true ? input.bonus.amount / 12 : 0
  const 월소정근로시간 = input.monthlyWorkHours
  const 고정수당: Record<FixedAllowanceKind, number> = { overtime: 0, night: 0, holiday: 0, holidayOvertime: 0 }
  let baseSalary: number
  let 통상시급: number
  if (input.wageType === 'MONTHLY') {
    if (input.fixedAllowanceAutoCalc) {
      const 가산율적용고정시간 = sum(
        고정수당종류.map((kind) =>
          input.fixedAllowances[kind].enabled
            ? input.fixedAllowances[kind].hours * 지급배율(input.premiumMultipliers, kind)
            : 0,
        ),
      )
      통상시급 =
        (input.amount - 지급항목합계 + 통상임금항목합계 + 통상임금상여월할액) / (월소정근로시간 + 가산율적용고정시간)
      for (const kind of 고정수당종류) {
        const 고정수당설정 = input.fixedAllowances[kind]
        if (고정수당설정.enabled)
          고정수당[kind] = Math.round(통상시급 * 고정수당설정.hours * 지급배율(input.premiumMultipliers, kind))
      }
      baseSalary = input.amount - 지급항목합계 - sum(Object.values(고정수당))
    } else {
      for (const kind of 고정수당종류)
        if (input.fixedAllowances[kind].enabled) 고정수당[kind] = input.fixedAllowances[kind].amount
      baseSalary = input.amount - 지급항목합계 - sum(Object.values(고정수당))
      통상시급 = (baseSalary + 통상임금항목합계 + 통상임금상여월할액) / 월소정근로시간
    }
  } else {
    const 시급 = input.wageType === 'HOURLY' ? input.amount : input.amount / (input.dailyWorkHours ?? 8)
    baseSalary = Math.round(시급 * 월소정근로시간)
    통상시급 = 시급 + (통상임금항목합계 + 통상임금상여월할액) / 월소정근로시간
  }
  const 기준시급 = baseSalary / 월소정근로시간
  const 최저임금시급 = (baseSalary + 최저임금산입항목합계) / 월소정근로시간
  return {
    baseSalary,
    baseHourlyWage: round2(기준시급),
    ordinaryHourlyWage: round2(통상시급),
    ...(input.probationPayRatePpm === undefined
      ? {}
      : { probationHourlyWage: round2((기준시급 * input.probationPayRatePpm) / 1_000_000) }),
    fixedAllowanceAmounts: 고정수당,
    minimumWageHourly: round2(최저임금시급),
    isBelowMinimumWage: 최저임금시급 < input.minimumHourlyWage,
  }
}

function sum(values: ReadonlyArray<number>): number {
  return values.reduce((total, value) => total + value, 0)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
