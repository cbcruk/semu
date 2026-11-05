import type { InsurancePremiums, SocialInsuranceInput, SocialInsuranceResult, TraceEntry } from './engine.types'
import { applyPpm, formatPpm, formatWon, truncateTo } from './engine.utils'
import type { PayrollRateTable } from './rate-table.types'

/**
 * Calculates the employee and employer shares of the four social insurances for one month.
 *
 * Rounding, per {@linkcode PayrollRateTable} (unverified practice):
 *
 * - 국민연금: 기준소득월액 is clamped to the base limits and truncated below
 *   1,000 won, then `base × rate` is truncated below 10 won.
 * - 건강보험: `보수월액 × rate`, truncated below 10 won.
 * - 장기요양: `건강보험료 × ratio`, truncated below 10 won, per side.
 * - 고용보험: `보수 × rate`, truncated below 10 won. The employer side adds the
 *   고용안정·직업능력개발 rate.
 * - 산재보험: employer only, `보수 × company rate`.
 *
 * With `notice`, the noticed amount is taken as is and nothing is computed for
 * that insurance; with `exempt`, both sides are zero.
 *
 * @example A 3,000,000 won salary by rate
 * ```ts
 * import { calculateSocialInsurance } from './social-insurance'
 * import { RATES_2026_01 } from './rate-table-2026'
 *
 * const result = calculateSocialInsurance(
 *   {
 *     insurablePay: 3_000_000,
 *     nationalPension: { mode: 'rate' },
 *     healthInsurance: { mode: 'rate' },
 *     employmentInsurance: { mode: 'rate' },
 *   },
 *   RATES_2026_01,
 * )
 * result.employee.total // 142,500 + 107,850 + 14,170 + 27,000 = 291,520
 * ```
 */
export function calculateSocialInsurance(input: SocialInsuranceInput, rates: PayrollRateTable): SocialInsuranceResult {
  const trace: TraceEntry[] = []
  const employee = emptyPremiums()
  const employer = emptyPremiums()

  const pension = input.nationalPension
  if (pension.mode === 'notice') {
    employee.nationalPension = pension.noticeAmount ?? 0
    employer.nationalPension = pension.employerNoticeAmount ?? employee.nationalPension
    trace.push({ code: 'national_pension', label: '국민연금', amount: employee.nationalPension, formula: '고지 금액' })
  } else if (pension.mode === 'rate') {
    const table = rates.nationalPension
    const reported = pension.baseMonthlyIncome ?? input.insurablePay
    const base = truncateTo(Math.min(Math.max(reported, table.baseMin), table.baseMax), table.baseRoundingUnit)
    employee.nationalPension = truncateTo(applyPpm(base, table.employeeRatePpm), table.premiumRoundingUnit)
    employer.nationalPension = truncateTo(applyPpm(base, table.employerRatePpm), table.premiumRoundingUnit)
    trace.push({
      code: 'national_pension',
      label: '국민연금',
      amount: employee.nationalPension,
      formula: `기준소득월액 ${formatWon(base)} × ${formatPpm(table.employeeRatePpm)} (${formatWon(table.baseMin)}~${formatWon(table.baseMax)}, ${table.premiumRoundingUnit}원 미만 절사)`,
    })
  }

  const health = input.healthInsurance
  if (health.mode === 'notice') {
    employee.healthInsurance = health.noticeAmount ?? 0
    employer.healthInsurance = health.employerNoticeAmount ?? employee.healthInsurance
    employee.longTermCare = health.longTermCareNoticeAmount ?? 0
    employer.longTermCare = employee.longTermCare
    trace.push({ code: 'health_insurance', label: '건강보험', amount: employee.healthInsurance, formula: '고지 금액' })
    trace.push({ code: 'long_term_care', label: '장기요양보험', amount: employee.longTermCare, formula: '고지 금액' })
  } else if (health.mode === 'rate') {
    const table = rates.healthInsurance
    const care = rates.longTermCare
    const base = health.baseMonthlyIncome ?? input.insurablePay
    employee.healthInsurance = truncateTo(applyPpm(base, table.employeeRatePpm), table.premiumRoundingUnit)
    employer.healthInsurance = truncateTo(applyPpm(base, table.employerRatePpm), table.premiumRoundingUnit)
    employee.longTermCare = truncateTo(applyPpm(employee.healthInsurance, care.ratioOfHealthPpm), care.premiumRoundingUnit)
    employer.longTermCare = truncateTo(applyPpm(employer.healthInsurance, care.ratioOfHealthPpm), care.premiumRoundingUnit)
    trace.push({
      code: 'health_insurance',
      label: '건강보험',
      amount: employee.healthInsurance,
      formula: `${formatWon(base)} × ${formatPpm(table.employeeRatePpm)} (${table.premiumRoundingUnit}원 미만 절사)`,
    })
    trace.push({
      code: 'long_term_care',
      label: '장기요양보험',
      amount: employee.longTermCare,
      formula: `건강보험료 ${formatWon(employee.healthInsurance)} × ${formatPpm(care.ratioOfHealthPpm)} (${care.premiumRoundingUnit}원 미만 절사)`,
    })
  }

  const employment = input.employmentInsurance
  const ei = rates.employmentInsurance
  const stabilityPpm = input.employerStabilityRatePpm ?? ei.employerStabilityRatePpm
  if (employment.mode === 'notice') {
    employee.employmentInsurance = employment.noticeAmount ?? 0
    employer.employmentInsurance =
      employment.employerNoticeAmount ??
      truncateTo(applyPpm(input.insurablePay, ei.employerUnemploymentRatePpm + stabilityPpm), ei.premiumRoundingUnit)
    trace.push({ code: 'employment_insurance', label: '고용보험', amount: employee.employmentInsurance, formula: '고지 금액' })
  } else if (employment.mode === 'rate') {
    const employeePpm = employment.kind === 'artist' ? ei.artistEmployeeRatePpm : ei.employeeRatePpm
    const employerPpm = employment.kind === 'artist' ? ei.artistEmployeeRatePpm : ei.employerUnemploymentRatePpm + stabilityPpm
    employee.employmentInsurance = truncateTo(applyPpm(input.insurablePay, employeePpm), ei.premiumRoundingUnit)
    employer.employmentInsurance = truncateTo(applyPpm(input.insurablePay, employerPpm), ei.premiumRoundingUnit)
    trace.push({
      code: 'employment_insurance',
      label: '고용보험',
      amount: employee.employmentInsurance,
      formula: `${formatWon(input.insurablePay)} × ${formatPpm(employeePpm)} (${ei.premiumRoundingUnit}원 미만 절사)`,
    })
  }

  const accident = rates.industrialAccident
  employer.industrialAccident = truncateTo(
    applyPpm(input.insurablePay, input.industrialAccidentRatePpm ?? accident.defaultEmployerRatePpm),
    accident.premiumRoundingUnit,
  )

  return { employee: withTotal(employee), employer: withTotal(employer), trace }
}

function emptyPremiums(): InsurancePremiums {
  return { nationalPension: 0, healthInsurance: 0, longTermCare: 0, employmentInsurance: 0, industrialAccident: 0, total: 0 }
}

function withTotal(premiums: InsurancePremiums): InsurancePremiums {
  return {
    ...premiums,
    total:
      premiums.nationalPension + premiums.healthInsurance + premiums.longTermCare + premiums.employmentInsurance + premiums.industrialAccident,
  }
}
