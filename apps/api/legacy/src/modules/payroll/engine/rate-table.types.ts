/**
 * A calendar month in `YYYY-MM` form, used as the effective month of a rate table and as the attribution month of a payroll row.
 */
export type YearMonth = string

/** Rounding unit in won: truncate to whole won (1), to 10 won, and so on. */
export type RoundingUnit = 1 | 10 | 100 | 1000

/**
 * One segment of a piecewise-linear schedule.
 *
 * For an input `x` up to `upTo` (inclusive), the value is `base + (x − over) × ratePpm / 1,000,000`.
 * The last segment has `upTo: null`.
 */
export interface LinearBracket {
  upTo: number | null
  base: number
  ratePpm: number
  over: number
}

/**
 * One income band of the 간이세액표 special deduction estimate.
 *
 * The value is `base + total × ratePpm` plus, for each adjustment, `max(0, total − over) × ratePpm` (signed).
 */
export interface SpecialDeductionBracket {
  upTo: number | null
  base: number
  ratePpm: number
  adjustments: readonly { over: number; ratePpm: number }[]
}

/** Segment of a per-unit schedule: `base + (x − over) × perUnit` for `x` up to `upTo` (inclusive). */
export interface PerUnitBracket {
  upTo: number | null
  base: number
  perUnit: number
  over: number
}

/** Progressive tax band: `taxable × ratePpm − progressiveDeduction` for taxable income up to `upTo`. */
export interface ProgressiveBracket {
  upTo: number | null
  ratePpm: number
  progressiveDeduction: number
}

/** Limit on the 근로소득세액공제 for a band of total annual pay. */
export interface EarnedIncomeCreditLimit {
  upTo: number | null
  base: number
  /** Reduction per won of pay above `over`, in ppm. */
  reductionPpm: number
  over: number
  floor: number
}

/** Width of the 간이세액표 rows in a pay range: rows start at `from` and step by `step` until `to` (exclusive). */
export interface SimpleTaxRowBand {
  from: number
  to: number
  step: number
}

/** Statutory non-taxable allowance categories recognised by the engine. */
export type NonTaxableCategory =
  | 'meal'
  | 'vehicle'
  | 'childcare'
  | 'research'
  | 'overseas'
  | 'overseas_special'
  | 'night_shift'
  | 'parental_leave'
  | 'tuition'
  | 'invention'

/** Statutory limit of a non-taxable category; `null` means no limit of that period. */
export interface NonTaxableLimit {
  monthlyLimit: number | null
  annualLimit: number | null
}

/** Provenance of one rate-table value. */
export interface RateVerification {
  /** `true` only when the spec notes or a product screen confirm the value. */
  verified: boolean
  source: string
}

/**
 * Payroll rates, limits and tax schedules in force from one month.
 *
 * Rates are integers in parts per million (ppm, 1% = 10,000 ppm) so 3.595% stays exact.
 * Amounts are integer won. Every leaf value has an entry in {@linkcode PayrollRateTable.verification}.
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
