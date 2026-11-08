import type { PremiumMultipliers } from '../../payroll/payroll.public.ts'

/** 임금 산정 방식입니다. */
export type WageType = 'MONTHLY' | 'DAILY' | 'HOURLY'

/** 고정임금제 수당 종류입니다. */
export type FixedAllowanceKind = 'overtime' | 'night' | 'holiday' | 'holidayOvertime'

/** 급여계약의 지급항목 하나입니다. */
export interface PaymentItemAmount {
  amount: number
  enabled: boolean
  /** 통상임금에 들어가는지입니다. 없으면 들어가는 것으로 봅니다. */
  ordinaryWage?: boolean | undefined
  /** 최저임금 산입 대상인지입니다. 없으면 산입합니다. */
  countsTowardMinimumWage?: boolean | undefined
}

/** 고정 수당 한 종류의 입력입니다. 자동계산이면 `amount`를 무시합니다. */
export interface FixedAllowanceInput {
  enabled: boolean
  hours: number
  amount: number
}

/** 파생 금액 계산 입력입니다. */
export interface WageInput {
  wageType: WageType
  /** 월급·일급·시급 금액(원)입니다. */
  amount: number
  monthlyWorkHours: number
  dailyWorkHours?: number | undefined
  paymentItems: ReadonlyArray<PaymentItemAmount>
  fixedAllowanceAutoCalc: boolean
  fixedAllowances: Record<FixedAllowanceKind, FixedAllowanceInput>
  /**
   * 자동계산 고정수당 1시간에 곱하는 지급배수(ppm)입니다. Payroll과 같은 값을 씁니다. 상시 5명 이상이면
   * `MULTIPLIERS_FIVE_OR_MORE`(연장 1.5, 야간 0.5, 휴일 1.5, 휴일연장 2), 4명 이하면 `MULTIPLIERS_UNDER_FIVE`(가산 없음)입니다.
   */
  premiumMultipliers: PremiumMultipliers
  /** 연 상여금입니다. `inOrdinaryWage`면 12로 나눠 통상임금에 넣습니다. */
  bonus?: { amount: number; inOrdinaryWage: boolean } | undefined
  /** 수습 지급률(ppm)입니다. 수습이 없으면 없습니다. */
  probationPayRatePpm?: number | undefined
  /** 비교할 최저시급(원)입니다. Payroll 기준표에서 계약 시작일 기준으로 읽습니다. */
  minimumHourlyWage: number
}

/** 서버가 계산하는 급여계약 파생 값입니다. 시급은 소수 둘째 자리까지 반올림합니다. */
export interface WageResult {
  baseSalary: number
  baseHourlyWage: number
  ordinaryHourlyWage: number
  probationHourlyWage?: number
  fixedAllowanceAmounts: Record<FixedAllowanceKind, number>
  minimumWageHourly: number
  isBelowMinimumWage: boolean
}
