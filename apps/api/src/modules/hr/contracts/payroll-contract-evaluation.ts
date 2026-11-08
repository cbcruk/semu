import type { Violation } from '../../../shared/problem/problem.types.ts'
import { calculateWage } from './wage-calculation.ts'
import type { FixedAllowanceInput, FixedAllowanceKind } from './wage-calculation.types.ts'
import type {
  PayrollContractEvaluation,
  PayrollContractTerms,
  PayrollContractWarning,
} from './payroll-contract-evaluation.types.ts'

/** 감액한 최저임금을 적용할 수 있는 수습 개월 수입니다(최저임금법 제5조 ②: 수습 시작일부터 3개월 이내). */
export const REDUCED_MINIMUM_WAGE_PROBATION_MONTHS = 3

/** 입력에서 빠진 고정수당을 채우는 값입니다. 꺼진(`enabled: false`) 고정수당이라는 뜻으로 지은 이름입니다. */
const 꺼진고정수당: FixedAllowanceInput = { enabled: false, hours: 0, amount: 0 }

/**
 * 급여계약을 검사하고 파생 금액(`docs/reference/rules/payroll-contract-wage.md`)을 계산합니다.
 *
 * - 종료일은 시작일 이후(`END_BEFORE_START`)
 * - 월급제에서 지급항목과 고정수당이 월급보다 크면 기본급이 음수가 되어 거부(`BASE_SALARY_NEGATIVE`)
 * - 최저임금 미달은 거부하지 않고 `warnings`에 `BELOW_MINIMUM_WAGE`로 담습니다
 * - 수습이 3개월을 넘고 수습 시급(최저임금 산입 시급 × 지급률)이 최저시급보다 낮으면 `PROBATION_BELOW_MINIMUM_WAGE`입니다.
 *   3개월 안의 감액(90% 이상)은 근로계약 검증이 허용 조건을 봅니다
 *
 * @example
 * ```ts
 * evaluatePayrollContract({ startDate: '2026-01-01', wageType: 'MONTHLY', amount: 2_000_000, monthlyWorkHours: 209 }, {
 *   minimumHourlyWage: 10_320,
 * }).warnings // ['BELOW_MINIMUM_WAGE']
 * ```
 */
export function evaluatePayrollContract(
  terms: PayrollContractTerms,
  context: {
    minimumHourlyWage: number
    probationPayRatePpm?: number | undefined
    probationMonths?: number | undefined
  },
): PayrollContractEvaluation {
  const 고정수당입력 = terms.fixedAllowances ?? {}
  const fixedAllowances: Record<FixedAllowanceKind, FixedAllowanceInput> = {
    overtime: 고정수당입력.overtime ?? 꺼진고정수당,
    night: 고정수당입력.night ?? 꺼진고정수당,
    holiday: 고정수당입력.holiday ?? 꺼진고정수당,
    holidayOvertime: 고정수당입력.holidayOvertime ?? 꺼진고정수당,
  }
  const 파생금액 = calculateWage({
    wageType: terms.wageType,
    amount: terms.amount,
    monthlyWorkHours: terms.monthlyWorkHours,
    dailyWorkHours: terms.dailyWorkHours,
    paymentItems: terms.paymentItems ?? [],
    fixedAllowanceAutoCalc: terms.fixedAllowanceAutoCalc ?? false,
    fixedAllowances,
    bonus: terms.bonus,
    probationPayRatePpm: context.probationPayRatePpm,
    minimumHourlyWage: context.minimumHourlyWage,
  })
  const violations: Violation[] = []
  if (terms.endDate !== undefined && terms.endDate < terms.startDate) {
    violations.push({ field: 'endDate', code: 'END_BEFORE_START' })
  }
  if (파생금액.baseSalary < 0) violations.push({ field: 'amount', code: 'BASE_SALARY_NEGATIVE' })
  const warnings: PayrollContractWarning[] = 파생금액.isBelowMinimumWage ? ['BELOW_MINIMUM_WAGE'] : []
  const 수습지급률 = context.probationPayRatePpm
  if (
    수습지급률 !== undefined &&
    (context.probationMonths ?? 0) > REDUCED_MINIMUM_WAGE_PROBATION_MONTHS &&
    (파생금액.minimumWageHourly * 수습지급률) / 1_000_000 < context.minimumHourlyWage
  ) {
    warnings.push('PROBATION_BELOW_MINIMUM_WAGE')
  }
  return {
    violations,
    derived: { ...파생금액, statutoryMinimumHourlyWage: context.minimumHourlyWage },
    warnings,
  }
}
