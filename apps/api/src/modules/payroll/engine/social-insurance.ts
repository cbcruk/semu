import { applyPpm, formatPpm, formatWon, truncateTo } from './engine-math.ts'
import type { InsurancePremiums, SocialInsuranceInput, SocialInsuranceResult, TraceEntry } from './engine.types.ts'
import type { PayrollRateTable } from './rate-table.types.ts'

/**
 * 한 달 4대보험료의 근로자·사업주 부담분을 계산합니다.
 *
 * 절사 단위는 기준표 값입니다. 국민연금·건강보험·장기요양은 법령으로 확인했고(국민연금법 제117조, 국민건강보험법 제107조,
 * 노인장기요양보험법 제64조), 고용·산재보험은 조문을 찾지 못해 미확인입니다.
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
  const 근로자부담 = 빈보험료()
  const 사업주부담 = 빈보험료()

  const 국민연금 = input.nationalPension
  if (국민연금.mode === 'NOTICE') {
    근로자부담.nationalPension = 국민연금.noticeAmount ?? 0
    사업주부담.nationalPension = 국민연금.employerNoticeAmount ?? 근로자부담.nationalPension
    trace.push({
      code: 'NATIONAL_PENSION',
      label: '국민연금',
      amount: 근로자부담.nationalPension,
      formula: '고지 금액',
    })
  } else if (국민연금.mode === 'RATE') {
    const 국민연금기준 = rates.nationalPension
    const 소득월액 = 국민연금.baseMonthlyIncome ?? input.insurablePay
    const 기준소득월액 = truncateTo(
      Math.min(Math.max(소득월액, 국민연금기준.baseMin), 국민연금기준.baseMax),
      국민연금기준.baseRoundingUnit,
    )
    근로자부담.nationalPension = truncateTo(
      applyPpm(기준소득월액, 국민연금기준.employeeRatePpm),
      국민연금기준.premiumRoundingUnit,
    )
    사업주부담.nationalPension = truncateTo(
      applyPpm(기준소득월액, 국민연금기준.employerRatePpm),
      국민연금기준.premiumRoundingUnit,
    )
    trace.push({
      code: 'NATIONAL_PENSION',
      label: '국민연금',
      amount: 근로자부담.nationalPension,
      formula: `기준소득월액 ${formatWon(기준소득월액)} × ${formatPpm(국민연금기준.employeeRatePpm)} (${formatWon(국민연금기준.baseMin)}~${formatWon(국민연금기준.baseMax)}, ${국민연금기준.premiumRoundingUnit}원 미만 절사)`,
    })
  }

  const 건강보험 = input.healthInsurance
  if (건강보험.mode === 'NOTICE') {
    근로자부담.healthInsurance = 건강보험.noticeAmount ?? 0
    사업주부담.healthInsurance = 건강보험.employerNoticeAmount ?? 근로자부담.healthInsurance
    근로자부담.longTermCare = 건강보험.longTermCareNoticeAmount ?? 0
    사업주부담.longTermCare = 근로자부담.longTermCare
    trace.push({
      code: 'HEALTH_INSURANCE',
      label: '건강보험',
      amount: 근로자부담.healthInsurance,
      formula: '고지 금액',
    })
    trace.push({ code: 'LONG_TERM_CARE', label: '장기요양보험', amount: 근로자부담.longTermCare, formula: '고지 금액' })
  } else if (건강보험.mode === 'RATE') {
    const 건강보험기준 = rates.healthInsurance
    const 장기요양기준 = rates.longTermCare
    const 보수월액 = 건강보험.baseMonthlyIncome ?? input.insurablePay
    근로자부담.healthInsurance = truncateTo(
      applyPpm(보수월액, 건강보험기준.employeeRatePpm),
      건강보험기준.premiumRoundingUnit,
    )
    사업주부담.healthInsurance = truncateTo(
      applyPpm(보수월액, 건강보험기준.employerRatePpm),
      건강보험기준.premiumRoundingUnit,
    )
    근로자부담.longTermCare = truncateTo(
      applyPpm(근로자부담.healthInsurance, 장기요양기준.ratioOfHealthPpm),
      장기요양기준.premiumRoundingUnit,
    )
    사업주부담.longTermCare = truncateTo(
      applyPpm(사업주부담.healthInsurance, 장기요양기준.ratioOfHealthPpm),
      장기요양기준.premiumRoundingUnit,
    )
    trace.push({
      code: 'HEALTH_INSURANCE',
      label: '건강보험',
      amount: 근로자부담.healthInsurance,
      formula: `${formatWon(보수월액)} × ${formatPpm(건강보험기준.employeeRatePpm)} (${건강보험기준.premiumRoundingUnit}원 미만 절사)`,
    })
    trace.push({
      code: 'LONG_TERM_CARE',
      label: '장기요양보험',
      amount: 근로자부담.longTermCare,
      formula: `건강보험료 ${formatWon(근로자부담.healthInsurance)} × ${formatPpm(장기요양기준.ratioOfHealthPpm)} (${장기요양기준.premiumRoundingUnit}원 미만 절사)`,
    })
  }

  const 고용보험 = input.employmentInsurance
  const 고용보험기준 = rates.employmentInsurance
  // 고용안정·직업능력개발사업 요율(사업주 부담)
  const 고용안정요율ppm = input.employerStabilityRatePpm ?? 고용보험기준.employerStabilityRatePpm
  if (고용보험.mode === 'NOTICE') {
    근로자부담.employmentInsurance = 고용보험.noticeAmount ?? 0
    사업주부담.employmentInsurance =
      고용보험.employerNoticeAmount ??
      truncateTo(
        applyPpm(input.insurablePay, 고용보험기준.employerUnemploymentRatePpm + 고용안정요율ppm),
        고용보험기준.premiumRoundingUnit,
      )
    trace.push({
      code: 'EMPLOYMENT_INSURANCE',
      label: '고용보험',
      amount: 근로자부담.employmentInsurance,
      formula: '고지 금액',
    })
  } else if (고용보험.mode === 'RATE') {
    const 예술인임 = 고용보험.kind === 'ARTIST'
    const 근로자요율ppm = 예술인임 ? 고용보험기준.artistEmployeeRatePpm : 고용보험기준.employeeRatePpm
    const 사업주요율ppm = 예술인임
      ? 고용보험기준.artistEmployeeRatePpm
      : 고용보험기준.employerUnemploymentRatePpm + 고용안정요율ppm
    근로자부담.employmentInsurance = truncateTo(
      applyPpm(input.insurablePay, 근로자요율ppm),
      고용보험기준.premiumRoundingUnit,
    )
    사업주부담.employmentInsurance = truncateTo(
      applyPpm(input.insurablePay, 사업주요율ppm),
      고용보험기준.premiumRoundingUnit,
    )
    trace.push({
      code: 'EMPLOYMENT_INSURANCE',
      label: '고용보험',
      amount: 근로자부담.employmentInsurance,
      formula: `${formatWon(input.insurablePay)} × ${formatPpm(근로자요율ppm)} (${고용보험기준.premiumRoundingUnit}원 미만 절사)`,
    })
  }

  const 산재보험기준 = rates.industrialAccident
  사업주부담.industrialAccident = truncateTo(
    applyPpm(input.insurablePay, input.industrialAccidentRatePpm ?? 산재보험기준.defaultEmployerRatePpm),
    산재보험기준.premiumRoundingUnit,
  )

  return { employee: 합계포함(근로자부담), employer: 합계포함(사업주부담), trace }
}

function 빈보험료(): InsurancePremiums {
  return {
    nationalPension: 0,
    healthInsurance: 0,
    longTermCare: 0,
    employmentInsurance: 0,
    industrialAccident: 0,
    total: 0,
  }
}

function 합계포함(보험료: InsurancePremiums): InsurancePremiums {
  return {
    ...보험료,
    total:
      보험료.nationalPension +
      보험료.healthInsurance +
      보험료.longTermCare +
      보험료.employmentInsurance +
      보험료.industrialAccident,
  }
}
