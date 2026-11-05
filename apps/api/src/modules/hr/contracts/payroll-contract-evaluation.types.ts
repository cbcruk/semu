import type { Violation } from '../../../shared/problem/problem.types.ts'
import type {
  FixedAllowanceInput,
  FixedAllowanceKind,
  PaymentItemAmount,
  WageResult,
  WageType,
} from './wage-calculation.types.ts'

/** 급여계약에서 파생 금액과 검증에 쓰는 값입니다. 고정수당은 켠 종류만 보내도 됩니다. */
export interface PayrollContractTerms {
  startDate: string
  endDate?: string | undefined
  wageType: WageType
  amount: number
  monthlyWorkHours: number
  dailyWorkHours?: number | undefined
  paymentItems?: ReadonlyArray<PaymentItemAmount> | undefined
  fixedAllowanceAutoCalc?: boolean | undefined
  fixedAllowances?: Partial<Record<FixedAllowanceKind, FixedAllowanceInput>> | undefined
  bonus?: { amount: number; inOrdinaryWage: boolean } | undefined
}

/** 서버가 계산해 응답에 넣는 파생 값입니다. */
export interface PayrollContractDerived extends WageResult {
  /** 비교한 최저시급(원)입니다. */
  statutoryMinimumHourlyWage: number
}

/**
 * 저장을 막지 않는 경고입니다.
 *
 * - `BELOW_MINIMUM_WAGE`: 최저임금 산입 시급이 최저시급보다 낮습니다
 * - `PROBATION_BELOW_MINIMUM_WAGE`: 수습이 3개월을 넘는데 수습 시급이 최저시급보다 낮습니다. 감액한 최저임금(90%)은
 *   수습 시작일부터 3개월까지만 적용됩니다(최저임금법 제5조 ②, 시행령 제3조)
 */
export type PayrollContractWarning = 'BELOW_MINIMUM_WAGE' | 'PROBATION_BELOW_MINIMUM_WAGE'

/** 급여계약 평가 결과입니다. 위반이 있으면 저장하지 않고, 경고는 저장을 막지 않습니다. */
export interface PayrollContractEvaluation {
  violations: Violation[]
  derived: PayrollContractDerived
  warnings: PayrollContractWarning[]
}
