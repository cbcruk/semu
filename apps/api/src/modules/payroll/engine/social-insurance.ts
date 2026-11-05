import { applyPpm, formatPpm, formatWon, truncateTo } from './engine-math.ts'
import type { InsurancePremiums, SocialInsuranceInput, SocialInsuranceResult, TraceEntry } from './engine.types.ts'
import type { PayrollRateTable } from './rate-table.types.ts'

/**
 * 한 달 4대보험료의 근로자·사업주 부담분을 계산합니다.
 *
 * 절사 단위는 기준표 값입니다(관행, 미확인).
 *
 * - 국민연금: 기준소득월액을 상하한으로 자른 뒤 천원 미만 절사, `기준소득월액 × 요율`을 10원 미만 절사
 * - 건강보험: `보수월액 × 요율`, 10원 미만 절사
 * - 장기요양: 각 측 `건강보험료 × 비율`, 10원 미만 절사
 * - 고용보험: `보수 × 요율`, 10원 미만 절사. 사업주는 고용안정·직업능력개발 요율을 더합니다
 * - 산재보험: 사업주만 `보수 × 회사 요율`
 *
 * `NOTICE`는 고지액을 그대로 쓰고 계산하지 않습니다. `EXEMPT`는 양쪽 모두 0입니다.
 *
 * @example 월 3,000,000원을 요율로
 * ```ts
 * const result = calculateSocialInsurance(
 *   {
 *     insurablePay: 3_000_000,
 *     nationalPension: { mode: 'RATE' },
 *     healthInsurance: { mode: 'RATE' },
 *     employmentInsurance: { mode: 'RATE' },
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
  if (pension.mode === 'NOTICE') {
    employee.nationalPension = pension.noticeAmount ?? 0
    employer.nationalPension = pension.employerNoticeAmount ?? employee.nationalPension
    trace.push({ code: 'NATIONAL_PENSION', label: '국민연금', amount: employee.nationalPension, formula: '고지 금액' })
  } else if (pension.mode === 'RATE') {
    const table = rates.nationalPension
    const reported = pension.baseMonthlyIncome ?? input.insurablePay
    const base = truncateTo(Math.min(Math.max(reported, table.baseMin), table.baseMax), table.baseRoundingUnit)
    employee.nationalPension = truncateTo(applyPpm(base, table.employeeRatePpm), table.premiumRoundingUnit)
    employer.nationalPension = truncateTo(applyPpm(base, table.employerRatePpm), table.premiumRoundingUnit)
    trace.push({
      code: 'NATIONAL_PENSION',
      label: '국민연금',
      amount: employee.nationalPension,
      formula: `기준소득월액 ${formatWon(base)} × ${formatPpm(table.employeeRatePpm)} (${formatWon(table.baseMin)}~${formatWon(table.baseMax)}, ${table.premiumRoundingUnit}원 미만 절사)`,
    })
  }

  const health = input.healthInsurance
  if (health.mode === 'NOTICE') {
    employee.healthInsurance = health.noticeAmount ?? 0
    employer.healthInsurance = health.employerNoticeAmount ?? employee.healthInsurance
    employee.longTermCare = health.longTermCareNoticeAmount ?? 0
    employer.longTermCare = employee.longTermCare
    trace.push({ code: 'HEALTH_INSURANCE', label: '건강보험', amount: employee.healthInsurance, formula: '고지 금액' })
    trace.push({ code: 'LONG_TERM_CARE', label: '장기요양보험', amount: employee.longTermCare, formula: '고지 금액' })
  } else if (health.mode === 'RATE') {
    const table = rates.healthInsurance
    const care = rates.longTermCare
    const base = health.baseMonthlyIncome ?? input.insurablePay
    employee.healthInsurance = truncateTo(applyPpm(base, table.employeeRatePpm), table.premiumRoundingUnit)
    employer.healthInsurance = truncateTo(applyPpm(base, table.employerRatePpm), table.premiumRoundingUnit)
    employee.longTermCare = truncateTo(
      applyPpm(employee.healthInsurance, care.ratioOfHealthPpm),
      care.premiumRoundingUnit,
    )
    employer.longTermCare = truncateTo(
      applyPpm(employer.healthInsurance, care.ratioOfHealthPpm),
      care.premiumRoundingUnit,
    )
    trace.push({
      code: 'HEALTH_INSURANCE',
      label: '건강보험',
      amount: employee.healthInsurance,
      formula: `${formatWon(base)} × ${formatPpm(table.employeeRatePpm)} (${table.premiumRoundingUnit}원 미만 절사)`,
    })
    trace.push({
      code: 'LONG_TERM_CARE',
      label: '장기요양보험',
      amount: employee.longTermCare,
      formula: `건강보험료 ${formatWon(employee.healthInsurance)} × ${formatPpm(care.ratioOfHealthPpm)} (${care.premiumRoundingUnit}원 미만 절사)`,
    })
  }

  const employment = input.employmentInsurance
  const ei = rates.employmentInsurance
  const stabilityPpm = input.employerStabilityRatePpm ?? ei.employerStabilityRatePpm
  if (employment.mode === 'NOTICE') {
    employee.employmentInsurance = employment.noticeAmount ?? 0
    employer.employmentInsurance =
      employment.employerNoticeAmount ??
      truncateTo(applyPpm(input.insurablePay, ei.employerUnemploymentRatePpm + stabilityPpm), ei.premiumRoundingUnit)
    trace.push({
      code: 'EMPLOYMENT_INSURANCE',
      label: '고용보험',
      amount: employee.employmentInsurance,
      formula: '고지 금액',
    })
  } else if (employment.mode === 'RATE') {
    const artist = employment.kind === 'ARTIST'
    const employeePpm = artist ? ei.artistEmployeeRatePpm : ei.employeeRatePpm
    const employerPpm = artist ? ei.artistEmployeeRatePpm : ei.employerUnemploymentRatePpm + stabilityPpm
    employee.employmentInsurance = truncateTo(applyPpm(input.insurablePay, employeePpm), ei.premiumRoundingUnit)
    employer.employmentInsurance = truncateTo(applyPpm(input.insurablePay, employerPpm), ei.premiumRoundingUnit)
    trace.push({
      code: 'EMPLOYMENT_INSURANCE',
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
  return {
    nationalPension: 0,
    healthInsurance: 0,
    longTermCare: 0,
    employmentInsurance: 0,
    industrialAccident: 0,
    total: 0,
  }
}

function withTotal(premiums: InsurancePremiums): InsurancePremiums {
  return {
    ...premiums,
    total:
      premiums.nationalPension +
      premiums.healthInsurance +
      premiums.longTermCare +
      premiums.employmentInsurance +
      premiums.industrialAccident,
  }
}
