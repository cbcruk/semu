/** 귀속월·기준표 적용 시작월처럼 달이 단위인 값입니다. 형식은 `YYYY-MM`입니다. */
export type YearMonth = string

/** 절사 단위(원)입니다. 1이면 원 미만, 10이면 10원 미만을 버립니다. */
export type RoundingUnit = 1 | 10 | 100 | 1000

/**
 * 구간별 선형식의 한 구간입니다. `x`가 `upTo` 이하이면 `base + (x − over) × ratePpm / 1,000,000`입니다.
 *
 * 마지막 구간은 `upTo`가 `null`입니다.
 */
export interface LinearBracket {
  upTo: number | null
  base: number
  ratePpm: number
  over: number
}

/**
 * 간이세액표 특별소득공제 추정식의 한 구간입니다.
 *
 * 값은 `base + 총급여 × ratePpm`에 조정마다 `max(0, 총급여 − over) × ratePpm`(부호 포함)을 더한 것입니다.
 */
export interface SpecialDeductionBracket {
  upTo: number | null
  base: number
  ratePpm: number
  adjustments: readonly { over: number; ratePpm: number }[]
}

/** 단위당 계단식의 한 구간입니다. `x`가 `upTo` 이하이면 `base + (x − over) × perUnit`입니다. 근속연수공제에 씁니다. */
export interface PerUnitBracket {
  upTo: number | null
  base: number
  perUnit: number
  over: number
}

/** 종합소득 기본세율 구간입니다. 과세표준이 `upTo` 이하이면 `과세표준 × ratePpm − progressiveDeduction`입니다. */
export interface ProgressiveBracket {
  upTo: number | null
  ratePpm: number
  progressiveDeduction: number
}

/** 총급여 구간별 근로소득세액공제 한도입니다. */
export interface EarnedIncomeCreditLimit {
  upTo: number | null
  base: number
  /** `over`를 넘는 총급여 1원당 줄어드는 한도(ppm)입니다. */
  reductionPpm: number
  over: number
  floor: number
}

/** 간이세액표 행 폭입니다. `from`부터 `to` 전까지 `step`원 간격으로 행이 있습니다. */
export interface SimpleTaxRowBand {
  from: number
  to: number
  step: number
}

/** 간이세액표 한 행입니다. 월 급여 구간과 공제대상가족 수별 월 세액입니다. */
export interface SimpleTaxTableRow {
  /** 월 급여 하한(이상)입니다. */
  min: number
  /** 월 급여 상한(미만)입니다. */
  max: number
  /** 공제대상가족 1~11명의 월 세액입니다. 자녀 공제와 원천징수 비율을 적용하기 전입니다. */
  taxes: readonly number[]
}

/** 공식 근로소득 간이세액표(소득세법 시행령 별표 2)입니다. */
export interface SimpleTaxTable {
  /** 첫 행(`tableMinimumPay`)부터 `highIncomeThreshold` 미만까지 빈틈없이 이어진 행입니다. */
  rows: readonly SimpleTaxTableRow[]
  /** 월 급여가 정확히 `highIncomeThreshold`(10,000천원)인 행의 공제대상가족 1~11명 세액입니다. 그보다 많으면 여기에 산식을 더합니다. */
  atHighIncomeThreshold: readonly number[]
}

/** 엔진이 아는 근로소득 비과세 유형입니다. */
export type NonTaxableCategory =
  | 'MEAL'
  | 'VEHICLE'
  | 'CHILDCARE'
  | 'RESEARCH'
  | 'OVERSEAS'
  | 'OVERSEAS_SPECIAL'
  | 'NIGHT_SHIFT'
  | 'PARENTAL_LEAVE'
  | 'TUITION'
  | 'INVENTION'

/** 비과세 유형의 법정 한도입니다. `null`이면 그 기간 한도가 없습니다. */
export interface NonTaxableLimit {
  monthlyLimit: number | null
  annualLimit: number | null
  /**
   * `true`면 `monthlyLimit`이 대상 자녀 1명당 한도라 엔진이 보육수당 대상 자녀 수를 곱합니다. 보육수당은
   * 2026. 1. 1. 이후 지급분부터입니다(소득세법 제12조제3호머목2), 법률 제21221호). 그 전 기준표는 두지 않습니다.
   */
  perChild?: boolean
}

/** 기준표 값 하나의 출처입니다. */
export interface RateVerification {
  /** 스펙 노트·제품 화면이나 법령·고시 원문으로 확인한 값만 `true`입니다. 원문으로 확인하지 못한 값은 `false`이고 `source`에 이유를 적습니다. */
  verified: boolean
  source: string
}

/**
 * 한 달부터 적용하는 급여 요율·한도·세액 산식 묶음입니다.
 *
 * 요율은 ppm 정수(1% = 10,000)라 3.595%도 정확히 담습니다. 금액은 원 단위 정수입니다.
 * 모든 값은 {@link PayrollRateTable.verification}에 출처가 있습니다.
 */
export interface PayrollRateTable {
  effectiveFrom: YearMonth
  minimumWage: { hourly: number; monthly: number; monthlyHours: number }
  nationalPension: {
    employeeRatePpm: number
    employerRatePpm: number
    baseMin: number
    baseMax: number
    baseRoundingUnit: RoundingUnit
    premiumRoundingUnit: RoundingUnit
  }
  healthInsurance: { employeeRatePpm: number; employerRatePpm: number; premiumRoundingUnit: RoundingUnit }
  longTermCare: { ratioOfHealthPpm: number; premiumRoundingUnit: RoundingUnit }
  employmentInsurance: {
    employeeRatePpm: number
    employerUnemploymentRatePpm: number
    employerStabilityRatePpm: number
    artistEmployeeRatePpm: number
    premiumRoundingUnit: RoundingUnit
  }
  industrialAccident: { defaultEmployerRatePpm: number; premiumRoundingUnit: RoundingUnit }
  wageIncomeTax: {
    earnedIncomeDeduction: readonly LinearBracket[]
    earnedIncomeDeductionCap: number
    personalDeductionPerDependant: number
    specialDeductionByDependants: readonly { minDependants: number; brackets: readonly SpecialDeductionBracket[] }[]
    brackets: readonly ProgressiveBracket[]
    earnedIncomeCredit: { threshold: number; lowRatePpm: number; baseAbove: number; highRatePpm: number }
    earnedIncomeCreditLimits: readonly EarnedIncomeCreditLimit[]
    childCreditMonthly: { one: number; two: number; perAdditional: number }
    highIncomeThreshold: number
    highIncomeBrackets: readonly LinearBracket[]
    tableRowBands: readonly SimpleTaxRowBand[]
    tableMinimumPay: number
    /** 공식 간이세액표입니다. 기본 간이세액 전략 `OFFICIAL_TABLE`(`wage-income-tax.ts`)이 읽습니다. */
    simpleTaxTable: SimpleTaxTable
    taxRoundingUnit: RoundingUnit
  }
  localIncomeTax: { ratePpm: number; roundingUnit: RoundingUnit }
  dailyWorker: {
    dailyDeduction: number
    ratePpm: number
    creditPpm: number
    socialInsuranceMinDays: number
    socialInsuranceMinHours: number
  }
  businessIncome: { ratePpm: number }
  otherIncome: { ratePpm: number; minimumTaxableIncome: number }
  smallAmountExemption: number
  nonTaxable: Record<NonTaxableCategory, NonTaxableLimit>
  retirementIncomeTax: {
    serviceYearDeduction: readonly PerUnitBracket[]
    convertedPayDeduction: readonly LinearBracket[]
  }
  verification: Record<string, RateVerification>
}
