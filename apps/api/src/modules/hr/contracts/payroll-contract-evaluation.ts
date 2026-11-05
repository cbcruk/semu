import type { Violation } from '../../../shared/problem/problem.types.ts'
import { calculateWage } from './wage-calculation.ts'
import type { FixedAllowanceInput, FixedAllowanceKind } from './wage-calculation.types.ts'
import type { PayrollContractEvaluation, PayrollContractTerms } from './payroll-contract-evaluation.types.ts'

const OFF: FixedAllowanceInput = { enabled: false, hours: 0, amount: 0 }

/**
 * 급여계약을 검사하고 파생 금액(`docs/reference/rules/payroll-contract-wage.md`)을 계산합니다.
 *
 * - 종료일은 시작일 이후(`END_BEFORE_START`)
 * - 월급제에서 지급항목과 고정수당이 월급보다 크면 기본급이 음수가 되어 거부(`BASE_SALARY_NEGATIVE`)
 * - 최저임금 미달은 거부하지 않고 `warnings`에 `BELOW_MINIMUM_WAGE`로 담습니다
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
  context: { minimumHourlyWage: number; probationPayRatePpm?: number | undefined },
): PayrollContractEvaluation {
  const fixed = terms.fixedAllowances ?? {}
  const fixedAllowances: Record<FixedAllowanceKind, FixedAllowanceInput> = {
    overtime: fixed.overtime ?? OFF,
    night: fixed.night ?? OFF,
    holiday: fixed.holiday ?? OFF,
    holidayOvertime: fixed.holidayOvertime ?? OFF,
  }
  const result = calculateWage({
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
  if (result.baseSalary < 0) violations.push({ field: 'amount', code: 'BASE_SALARY_NEGATIVE' })
  return {
    violations,
    derived: { ...result, statutoryMinimumHourlyWage: context.minimumHourlyWage },
    warnings: result.isBelowMinimumWage ? ['BELOW_MINIMUM_WAGE'] : [],
  }
}
