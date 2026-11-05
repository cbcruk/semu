import type { PayrollRateTable, RateVerification } from './rate-table.types.ts'

const SPEC = 'docs/reference/spec/payroll.md'

function confirmed(source: string): RateVerification {
  return { verified: true, source }
}

function unverified(source: string): RateVerification {
  return { verified: false, source }
}

/**
 * 2026년 1월부터 적용하는 기준표입니다.
 *
 * {@link PayrollRateTable.verification}에서 `verified: false`인 값은 스펙이 아니라 법령을 기억해 넣은 것이라
 * 운영 전에 공식 고시로 확인해야 합니다. 목록은 `docs/design/payroll.md`의 기준표 절에 있습니다.
 */
export const RATES_2026_01: PayrollRateTable = {
  effectiveFrom: '2026-01',
  minimumWage: { hourly: 10_320, monthly: 2_156_880, monthlyHours: 209 },
  nationalPension: {
    employeeRatePpm: 47_500,
    employerRatePpm: 47_500,
    baseMin: 400_000,
    baseMax: 6_370_000,
    baseRoundingUnit: 1000,
    premiumRoundingUnit: 10,
  },
  healthInsurance: { employeeRatePpm: 35_950, employerRatePpm: 35_950, premiumRoundingUnit: 10 },
  longTermCare: { ratioOfHealthPpm: 131_400, premiumRoundingUnit: 10 },
  employmentInsurance: {
    employeeRatePpm: 9_000,
    employerUnemploymentRatePpm: 9_000,
    employerStabilityRatePpm: 2_500,
    artistEmployeeRatePpm: 8_000,
    premiumRoundingUnit: 10,
  },
  industrialAccident: { defaultEmployerRatePpm: 0, premiumRoundingUnit: 10 },
  wageIncomeTax: {
    earnedIncomeDeduction: [
      { upTo: 5_000_000, base: 0, ratePpm: 700_000, over: 0 },
      { upTo: 15_000_000, base: 3_500_000, ratePpm: 400_000, over: 5_000_000 },
      { upTo: 45_000_000, base: 7_500_000, ratePpm: 150_000, over: 15_000_000 },
      { upTo: 100_000_000, base: 12_000_000, ratePpm: 50_000, over: 45_000_000 },
      { upTo: null, base: 14_750_000, ratePpm: 20_000, over: 100_000_000 },
    ],
    earnedIncomeDeductionCap: 20_000_000,
    personalDeductionPerDependant: 1_500_000,
    specialDeductionByDependants: [
      {
        minDependants: 1,
        brackets: [
          { upTo: 30_000_000, base: 3_100_000, ratePpm: 40_000, adjustments: [] },
          { upTo: 45_000_000, base: 3_100_000, ratePpm: 40_000, adjustments: [{ over: 30_000_000, ratePpm: -50_000 }] },
          { upTo: 70_000_000, base: 3_100_000, ratePpm: 15_000, adjustments: [] },
          { upTo: 120_000_000, base: 3_100_000, ratePpm: 5_000, adjustments: [] },
        ],
      },
      {
        minDependants: 2,
        brackets: [
          { upTo: 30_000_000, base: 3_600_000, ratePpm: 40_000, adjustments: [] },
          { upTo: 45_000_000, base: 3_600_000, ratePpm: 40_000, adjustments: [{ over: 30_000_000, ratePpm: -50_000 }] },
          { upTo: 70_000_000, base: 3_600_000, ratePpm: 20_000, adjustments: [] },
          { upTo: 120_000_000, base: 3_600_000, ratePpm: 10_000, adjustments: [] },
        ],
      },
      {
        minDependants: 3,
        brackets: [
          { upTo: 30_000_000, base: 5_000_000, ratePpm: 70_000, adjustments: [] },
          {
            upTo: 45_000_000,
            base: 5_000_000,
            ratePpm: 70_000,
            adjustments: [
              { over: 30_000_000, ratePpm: -50_000 },
              { over: 40_000_000, ratePpm: 40_000 },
            ],
          },
          { upTo: 70_000_000, base: 5_000_000, ratePpm: 50_000, adjustments: [{ over: 40_000_000, ratePpm: 40_000 }] },
          { upTo: 120_000_000, base: 5_000_000, ratePpm: 30_000, adjustments: [{ over: 40_000_000, ratePpm: 40_000 }] },
        ],
      },
    ],
    brackets: [
      { upTo: 14_000_000, ratePpm: 60_000, progressiveDeduction: 0 },
      { upTo: 50_000_000, ratePpm: 150_000, progressiveDeduction: 1_260_000 },
      { upTo: 88_000_000, ratePpm: 240_000, progressiveDeduction: 5_760_000 },
      { upTo: 150_000_000, ratePpm: 350_000, progressiveDeduction: 15_440_000 },
      { upTo: 300_000_000, ratePpm: 380_000, progressiveDeduction: 19_940_000 },
      { upTo: 500_000_000, ratePpm: 400_000, progressiveDeduction: 25_940_000 },
      { upTo: 1_000_000_000, ratePpm: 420_000, progressiveDeduction: 35_940_000 },
      { upTo: null, ratePpm: 450_000, progressiveDeduction: 65_940_000 },
    ],
    earnedIncomeCredit: { threshold: 1_300_000, lowRatePpm: 550_000, baseAbove: 715_000, highRatePpm: 300_000 },
    earnedIncomeCreditLimits: [
      { upTo: 33_000_000, base: 740_000, reductionPpm: 0, over: 0, floor: 740_000 },
      { upTo: 70_000_000, base: 740_000, reductionPpm: 8_000, over: 33_000_000, floor: 660_000 },
      { upTo: 120_000_000, base: 660_000, reductionPpm: 500_000, over: 70_000_000, floor: 500_000 },
      { upTo: null, base: 500_000, reductionPpm: 500_000, over: 120_000_000, floor: 200_000 },
    ],
    childCreditMonthly: { one: 12_500, two: 29_160, perAdditional: 25_000 },
    highIncomeThreshold: 10_000_000,
    highIncomeBrackets: [
      { upTo: 14_000_000, base: 25_000, ratePpm: 343_000, over: 10_000_000 },
      { upTo: 28_000_000, base: 1_397_000, ratePpm: 372_400, over: 14_000_000 },
      { upTo: 30_000_000, base: 6_610_600, ratePpm: 392_000, over: 28_000_000 },
      { upTo: 45_000_000, base: 7_394_600, ratePpm: 400_000, over: 30_000_000 },
      { upTo: 87_000_000, base: 13_394_600, ratePpm: 420_000, over: 45_000_000 },
      { upTo: null, base: 31_034_600, ratePpm: 450_000, over: 87_000_000 },
    ],
    tableRowBands: [
      { from: 770_000, to: 1_500_000, step: 5_000 },
      { from: 1_500_000, to: 3_000_000, step: 10_000 },
      { from: 3_000_000, to: 10_000_000, step: 20_000 },
    ],
    tableMinimumPay: 770_000,
    taxRoundingUnit: 10,
  },
  localIncomeTax: { ratePpm: 100_000, roundingUnit: 10 },
  dailyWorker: {
    dailyDeduction: 150_000,
    ratePpm: 60_000,
    creditPpm: 550_000,
    socialInsuranceMinDays: 8,
    socialInsuranceMinHours: 60,
  },
  businessIncome: { ratePpm: 30_000 },
  otherIncome: { ratePpm: 200_000, minimumTaxableIncome: 50_000 },
  smallAmountExemption: 1_000,
  nonTaxable: {
    MEAL: { monthlyLimit: 200_000, annualLimit: null },
    VEHICLE: { monthlyLimit: 200_000, annualLimit: null },
    CHILDCARE: { monthlyLimit: 200_000, annualLimit: null },
    RESEARCH: { monthlyLimit: 200_000, annualLimit: null },
    OVERSEAS: { monthlyLimit: 1_000_000, annualLimit: null },
    OVERSEAS_SPECIAL: { monthlyLimit: 5_000_000, annualLimit: null },
    NIGHT_SHIFT: { monthlyLimit: null, annualLimit: 2_400_000 },
    PARENTAL_LEAVE: { monthlyLimit: null, annualLimit: null },
    TUITION: { monthlyLimit: null, annualLimit: null },
    INVENTION: { monthlyLimit: null, annualLimit: 7_000_000 },
  },
  retirementIncomeTax: {
    serviceYearDeduction: [
      { upTo: 5, base: 0, perUnit: 1_000_000, over: 0 },
      { upTo: 10, base: 5_000_000, perUnit: 2_000_000, over: 5 },
      { upTo: 20, base: 15_000_000, perUnit: 2_500_000, over: 10 },
      { upTo: null, base: 40_000_000, perUnit: 3_000_000, over: 20 },
    ],
    convertedPayDeduction: [
      { upTo: 8_000_000, base: 0, ratePpm: 1_000_000, over: 0 },
      { upTo: 70_000_000, base: 8_000_000, ratePpm: 600_000, over: 8_000_000 },
      { upTo: 100_000_000, base: 45_200_000, ratePpm: 550_000, over: 70_000_000 },
      { upTo: 300_000_000, base: 61_700_000, ratePpm: 450_000, over: 100_000_000 },
      { upTo: null, base: 151_700_000, ratePpm: 350_000, over: 300_000_000 },
    ],
  },
  verification: {
    'minimumWage.hourly': confirmed(`${SPEC} §2.9, screen 3b9f629f`),
    'minimumWage.monthly': confirmed(`${SPEC} §2.9, screen 3b9f629f`),
    'minimumWage.monthlyHours': confirmed(`${SPEC} §4.7 (2,156,880 = 10,320 × 209)`),
    'nationalPension.employeeRatePpm': confirmed(`${SPEC} §4.1`),
    'nationalPension.employerRatePpm': confirmed(`${SPEC} §4.1 (total 9.5%)`),
    'nationalPension.baseMin': unverified(`${SPEC} §4.1 (2025.7–2026.6 value, marked 확인 필요)`),
    'nationalPension.baseMax': unverified(`${SPEC} §4.1 (2025.7–2026.6 value, marked 확인 필요)`),
    'nationalPension.baseRoundingUnit': unverified('Practice: 기준소득월액 천원 미만 절사'),
    'nationalPension.premiumRoundingUnit': unverified(`${SPEC} §4.1 (10원 미만 절사 관행, 확인 필요)`),
    'healthInsurance.employeeRatePpm': confirmed(`${SPEC} §4.1`),
    'healthInsurance.employerRatePpm': confirmed(`${SPEC} §4.1 (total 7.19%)`),
    'healthInsurance.premiumRoundingUnit': unverified(`${SPEC} §4.1 (10원 미만 절사 관행, 확인 필요)`),
    'longTermCare.ratioOfHealthPpm': unverified(`${SPEC} §4.1 (13.14%, 확인 필요)`),
    'longTermCare.premiumRoundingUnit': unverified(`${SPEC} §4.1 (확인 필요)`),
    'employmentInsurance.employeeRatePpm': confirmed(`${SPEC} §4.1`),
    'employmentInsurance.employerUnemploymentRatePpm': unverified('Statute recall: 실업급여 사업주 0.9%'),
    'employmentInsurance.employerStabilityRatePpm': unverified(
      'Statute recall: 고용안정·직업능력개발 0.25% for under 150 employees; varies by size',
    ),
    'employmentInsurance.artistEmployeeRatePpm': unverified(`${SPEC} §4.1 (0.8%, 확인 필요)`),
    'employmentInsurance.premiumRoundingUnit': unverified(`${SPEC} §4.1 (확인 필요)`),
    'industrialAccident.defaultEmployerRatePpm': unverified('Industry-specific; callers should pass the company rate'),
    'industrialAccident.premiumRoundingUnit': unverified('Assumed to match the other premiums'),
    'wageIncomeTax.earnedIncomeDeduction': unverified('Statute recall: 소득세법 §47'),
    'wageIncomeTax.earnedIncomeDeductionCap': unverified('Statute recall: 소득세법 §47 (2천만원 한도)'),
    'wageIncomeTax.personalDeductionPerDependant': unverified('Statute recall: 소득세법 §50'),
    'wageIncomeTax.specialDeductionByDependants': unverified(
      'Statute recall: 소득세법 시행령 별표2 산식, low confidence',
    ),
    'wageIncomeTax.brackets': unverified('Statute recall: 소득세법 §55 (2023 개정)'),
    'wageIncomeTax.earnedIncomeCredit': unverified('Statute recall: 소득세법 §59'),
    'wageIncomeTax.earnedIncomeCreditLimits': unverified('Statute recall: 소득세법 §59'),
    'wageIncomeTax.childCreditMonthly': unverified('Statute recall: 2024 간이세액표 자녀 공제액'),
    'wageIncomeTax.highIncomeThreshold': unverified('Statute recall: 별표2 1천만원 초과 산식'),
    'wageIncomeTax.highIncomeBrackets': unverified('Statute recall: 별표2 1천만원 초과 산식'),
    'wageIncomeTax.tableRowBands': unverified('Statute recall: 별표2 구간 폭'),
    'wageIncomeTax.tableMinimumPay': unverified('Statute recall: 별표2 첫 구간'),
    'wageIncomeTax.taxRoundingUnit': unverified(`국고금 관리법 10원 미만 절사 관행; ${SPEC} §4.2 says 원 미만 절사`),
    'localIncomeTax.ratePpm': confirmed(`${SPEC} §4.2`),
    'localIncomeTax.roundingUnit': unverified(`지방세 10원 미만 절사 관행; ${SPEC} §4.2 says 원 미만 절사`),
    'dailyWorker.dailyDeduction': confirmed(`${SPEC} §4.3`),
    'dailyWorker.ratePpm': confirmed(`${SPEC} §4.3`),
    'dailyWorker.creditPpm': confirmed(`${SPEC} §4.3`),
    'dailyWorker.socialInsuranceMinDays': confirmed(`${SPEC} §4.1 (bundle DAILY_WORKER exclusion text)`),
    'dailyWorker.socialInsuranceMinHours': confirmed(`${SPEC} §4.1 (bundle DAILY_WORKER exclusion text)`),
    'businessIncome.ratePpm': confirmed(`${SPEC} §4.4`),
    'otherIncome.ratePpm': confirmed(`${SPEC} §4.5`),
    'otherIncome.minimumTaxableIncome': confirmed(`${SPEC} §4.5 (과세최저한 5만원)`),
    smallAmountExemption: confirmed(`${SPEC} §4.3, §4.4`),
    'nonTaxable.MEAL': confirmed(`${SPEC} §4.6`),
    'nonTaxable.VEHICLE': confirmed(`${SPEC} §4.6`),
    'nonTaxable.CHILDCARE': confirmed(`${SPEC} §4.6`),
    'nonTaxable.RESEARCH': confirmed(`${SPEC} §4.6`),
    'nonTaxable.OVERSEAS': unverified(`${SPEC} §4.6 (확인 필요)`),
    'nonTaxable.OVERSEAS_SPECIAL': unverified(`${SPEC} §4.6 (확인 필요)`),
    'nonTaxable.NIGHT_SHIFT': unverified(`${SPEC} §4.6 (확인 필요; 월정액급여 요건은 엔진 밖)`),
    'nonTaxable.PARENTAL_LEAVE': unverified(`${SPEC} §4.6 (확인 필요)`),
    'nonTaxable.TUITION': unverified(`${SPEC} §4.6 (확인 필요)`),
    'nonTaxable.INVENTION': unverified(`${SPEC} §4.6 (연 700만원, 확인 필요)`),
    'retirementIncomeTax.serviceYearDeduction': unverified(`${SPEC} §4.11 (수치 확인 필요; statute recall 2023 개정)`),
    'retirementIncomeTax.convertedPayDeduction': unverified(`${SPEC} §4.11 (수치 확인 필요; statute recall)`),
  },
}

/**
 * 국민연금 기준소득월액 상하한이 바뀌는 2026년 7월부터의 기준표입니다.
 *
 * 2026.7 상하한을 아직 몰라 1월 값을 반복하고 미확인으로 표시했습니다. 고시되면 값을 바꿉니다.
 */
export const RATES_2026_07: PayrollRateTable = {
  ...RATES_2026_01,
  effectiveFrom: '2026-07',
  verification: {
    ...RATES_2026_01.verification,
    'nationalPension.baseMin': unverified(`${SPEC} §4.1 (2026.7 이후 값 미확인; 2025.7 값 반복)`),
    'nationalPension.baseMax': unverified(`${SPEC} §4.1 (2026.7 이후 값 미확인; 2025.7 값 반복)`),
  },
}

/** 내장 기준표 전체입니다. 오래된 것부터이고, 기준표 저장소의 초기 데이터로 씁니다. */
export const BUILT_IN_RATE_TABLES: readonly PayrollRateTable[] = [RATES_2026_01, RATES_2026_07]
