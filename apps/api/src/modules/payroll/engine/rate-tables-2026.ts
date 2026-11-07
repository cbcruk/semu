import type { PayrollRateTable, RateVerification } from './rate-table.types.ts'

const SPEC = 'docs/reference/spec/payroll.md'

/** 국가법령정보센터 조문 주소입니다. 예: `law('소득세법', '제47조')` */
function law(name: string, article: string): string {
  return `https://www.law.go.kr/법령/${name}/${article}`
}

/** 국가법령정보센터 행정규칙(고시) 주소입니다. */
function notice(name: string): string {
  return `https://www.law.go.kr/행정규칙/${name}`
}

/** 소득세법 시행령 별표 2(근로소득 간이세액표) 주소입니다. `version`은 그 별표가 실린 시행령의 시행일입니다. */
function simpleTaxTable(version: string): string {
  return `https://www.law.go.kr/법령별표서식/(소득세법 시행령,${version},별표2)`
}

const SIMPLE_TAX_TABLE_2024 = `소득세법 시행령 별표 2 <개정 2024. 2. 29.> ${simpleTaxTable('20260201')}`
const SIMPLE_TAX_TABLE_2026 = `소득세법 시행령 별표 2 <개정 2026. 2. 27., 2026. 3. 1. 이후 원천징수분부터> ${simpleTaxTable('20261001')}`

function confirmed(source: string): RateVerification {
  return { verified: true, source }
}

function unverified(source: string): RateVerification {
  return { verified: false, source }
}

/**
 * 2026년 1월부터 적용하는 기준표입니다.
 *
 * 값마다 {@link PayrollRateTable.verification}에 법령·고시 원문 출처가 있습니다. `verified: false`로 남은 값은
 * 원문에서 확인하지 못한 것이고 이유를 출처에 적었습니다. 목록은 `docs/design/payroll.md`의 기준표 절에 있습니다.
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
    CHILDCARE: { monthlyLimit: 200_000, annualLimit: null, perChild: true },
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
    'minimumWage.hourly': confirmed(
      `고용노동부고시 제2025-47호(2025. 8. 5.) 2026년 적용 최저임금 시간급 10,320원. ${notice('2026년적용최저임금고시')}, https://www.minimumwage.go.kr/minWage/policy/decisionMain.do`,
    ),
    'minimumWage.monthly': confirmed(
      '고용노동부고시 제2025-47호(2025. 8. 5.) 월 환산액 2,156,880원(209시간 기준). https://www.minimumwage.go.kr/minWage/policy/decisionMain.do',
    ),
    'minimumWage.monthlyHours': confirmed(
      `최저임금위원회 결정 고시의 월 환산 기준 209시간 (2,156,880 = 10,320 × 209); ${SPEC} §4.7`,
    ),
    'nationalPension.employeeRatePpm': confirmed(
      `국민연금법 부칙(법률 제20903호, 2025. 4. 2.) 제4조제1항제1호: 2026년 기여금 기준소득월액의 1만분의 475. ${law('국민연금법', '제88조')} (부칙 제4조)`,
    ),
    'nationalPension.employerRatePpm': confirmed(
      `국민연금법 부칙(법률 제20903호, 2025. 4. 2.) 제4조제1항제1호: 2026년 부담금 1만분의 475 (합계 9.5%)`,
    ),
    'nationalPension.baseMin': confirmed(
      `보건복지부고시 제2025-24호(2025. 2. 3., 2025. 7. 1. 시행) 하한액 400천원, 2025년 7월분~2026년 6월분. ${notice('국민연금기준소득월액하한액과상한액')}`,
    ),
    'nationalPension.baseMax': confirmed(
      `보건복지부고시 제2025-24호(2025. 2. 3., 2025. 7. 1. 시행) 상한액 6,370천원, 2025년 7월분~2026년 6월분. ${notice('국민연금기준소득월액하한액과상한액')}`,
    ),
    'nationalPension.baseRoundingUnit': confirmed(
      `국민연금법 시행령 제5조제1항: 신고한 소득월액에서 천원 미만을 버린 금액. ${law('국민연금법시행령', '제5조')}`,
    ),
    'nationalPension.premiumRoundingUnit': confirmed(
      `국민연금법 제117조(10원 미만 단수는 국고금관리법 준용) + 국고금관리법 제47조제1항(10원 미만 끝수 계산하지 않음). ${law('국민연금법', '제117조')}`,
    ),
    'healthInsurance.employeeRatePpm': confirmed(
      `국민건강보험법 시행령 제44조제1항(2025. 12. 23. 개정) 보험료율 1만분의 719, 법 제76조제1항 근로자·사업주 100분의 50씩. ${law('국민건강보험법시행령', '제44조')}`,
    ),
    'healthInsurance.employerRatePpm': confirmed(
      `국민건강보험법 시행령 제44조제1항 1만분의 719, 법 제76조제1항 100분의 50 (합계 7.19%). ${law('국민건강보험법', '제76조')}`,
    ),
    'healthInsurance.premiumRoundingUnit': confirmed(
      `국민건강보험법 제107조(국고금관리법 제47조의 끝수는 계산하지 않음): 10원 미만 절사. ${law('국민건강보험법', '제107조')}`,
    ),
    'longTermCare.ratioOfHealthPpm': confirmed(
      `노인장기요양보험법 시행령 제4조(2025. 12. 30. 개정) 장기요양보험료율 100만분의 9,448, 국민건강보험법 시행령 제44조 1만분의 719. ` +
        `법 제9조제1항은 건강보험료에 "건강보험료율 대비 장기요양보험료율의 비율"을 곱합니다. 2026년 비율은 보건복지부 보도자료` +
        `(2025. 11. 4., "2026년도 장기요양보험료율 0.9448%")가 "2026년도 건강보험료 대비 장기요양보험료율은 13.14%이며, 장기요양보험료는 ` +
        `건강보험료에 해당 비율을 곱하여 납부하게 된다"고 정했습니다(0.9448 ÷ 7.19 = 0.131404…를 반올림한 값). ` +
        `https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1487817&mid=a10503000000`,
    ),
    'longTermCare.premiumRoundingUnit': confirmed(
      `노인장기요양보험법 제64조(국민건강보험법 제107조 준용): 10원 미만 절사. ${law('노인장기요양보험법', '제64조')}`,
    ),
    'employmentInsurance.employeeRatePpm': confirmed(
      `고용보험및산업재해보상보험의보험료징수등에관한법률 시행령 제12조제1항제2호 실업급여 1천분의 18, 법 제13조제2항 근로자는 그 2분의 1. ${law('고용보험및산업재해보상보험의보험료징수등에관한법률시행령', '제12조')}`,
    ),
    'employmentInsurance.employerUnemploymentRatePpm': confirmed(
      `보험료징수법 시행령 제12조제1항제2호 실업급여 1천분의 18 중 사업주 2분의 1 (법 제13조제2항). ${law('고용보험및산업재해보상보험의보험료징수등에관한법률시행령', '제12조')}`,
    ),
    'employmentInsurance.employerStabilityRatePpm': confirmed(
      `보험료징수법 시행령 제12조제1항제1호가목: 상시근로자 150명 미만 1만분의 25. 150명 이상 우선지원대상기업 1만분의 45, ` +
        `150명 이상 1천명 미만 1만분의 65, 1천명 이상·국가·지방자치단체 1만분의 85는 회사 값(employerStabilityRatePpm)으로 받습니다. ` +
        `${law('고용보험및산업재해보상보험의보험료징수등에관한법률시행령', '제12조')}`,
    ),
    'employmentInsurance.artistEmployeeRatePpm': confirmed(
      `보험료징수법 시행령 제56조의5제2항 예술인 고용보험료율 1천분의 16, 법 제48조의2제8항제2호(제13조제2항 준용)로 예술인·사업주 2분의 1씩. ` +
        `${law('고용보험및산업재해보상보험의보험료징수등에관한법률시행령', '제56조의5')}`,
    ),
    'employmentInsurance.premiumRoundingUnit': unverified(
      '보험료징수법과 같은 법 시행령에서 고용보험료 끝수 처리 조문을 찾지 못했습니다(국민연금법 제117조·국민건강보험법 제107조 같은 준용 규정 없음). ' +
        '근로복지공단 안내(https://www.comwel.or.kr/comwel/paym/insu/chek1.jsp)도 "보수총액 × 보험료율" 산식만 있고 끝수 처리는 없습니다. ' +
        '10원 미만 절사는 다른 보험료에 맞춘 학습용 가정입니다(docs/design/rule-decisions/payroll.md)',
    ),
    'industrialAccident.defaultEmployerRatePpm': unverified(
      '산재보험료율은 고용노동부장관이 사업 종류별로 고시합니다(보험료징수법 시행령 제13조). 기준표에는 하나의 값을 둘 수 없어 0이고, 회사 요율을 입력으로 받습니다',
    ),
    'industrialAccident.premiumRoundingUnit': unverified(
      '고용보험료와 같이 끝수 처리 조문을 찾지 못했습니다. 다른 보험료에 맞춘 학습용 가정입니다',
    ),
    'wageIncomeTax.earnedIncomeDeduction': confirmed(
      `소득세법 제47조제1항 근로소득공제 표. ${law('소득세법', '제47조')}`,
    ),
    'wageIncomeTax.earnedIncomeDeductionCap': confirmed(
      `소득세법 제47조제1항 단서: 공제액이 2천만원을 초과하면 2천만원. ${law('소득세법', '제47조')}`,
    ),
    'wageIncomeTax.personalDeductionPerDependant': confirmed(
      `소득세법 제50조제1항: 1명당 연 150만원. ${law('소득세법', '제50조')}`,
    ),
    'wageIncomeTax.specialDeductionByDependants': confirmed(
      `${SIMPLE_TAX_TABLE_2024} 제1호 "특별소득공제 및 특별세액공제 중 일부" 계산식. 2026. 2. 27. 개정 별표에서도 같습니다`,
    ),
    'wageIncomeTax.brackets': confirmed(
      `소득세법 제55조제1항 종합소득 기본세율(2022. 12. 31. 개정). ${law('소득세법', '제55조')}`,
    ),
    'wageIncomeTax.earnedIncomeCredit': confirmed(
      `소득세법 제59조제1항: 130만원 이하 100분의 55, 초과 71만5천원 + 초과분의 100분의 30. ${law('소득세법', '제59조')}`,
    ),
    'wageIncomeTax.earnedIncomeCreditLimits': confirmed(
      `소득세법 제59조제2항 총급여액별 한도(74만·66만·50만·20만원). ${law('소득세법', '제59조')}`,
    ),
    'wageIncomeTax.childCreditMonthly': confirmed(
      `${SIMPLE_TAX_TABLE_2024} 제3호: 8~20세 자녀 1명 12,500원, 2명 29,160원, 3명 이상 29,160원 + 2명 초과 1명당 25,000원`,
    ),
    'wageIncomeTax.highIncomeThreshold': confirmed(`${SIMPLE_TAX_TABLE_2024} 제6호 "10,000천원 초과" 산식`),
    'wageIncomeTax.highIncomeBrackets': confirmed(
      `${SIMPLE_TAX_TABLE_2024} 제6호: 10,000천원 초과 구간 가산액(25,000 / 1,397,000 / 6,610,600 / 7,394,600 / 13,394,600 / 31,034,600원)과 98%×세율`,
    ),
    'wageIncomeTax.tableRowBands': confirmed(
      `${SIMPLE_TAX_TABLE_2024} 제6호 월급여액 구간: 770~1,500천원 5천원, 1,500~3,000천원 1만원, 3,000~10,000천원 2만원`,
    ),
    'wageIncomeTax.tableMinimumPay': confirmed(`${SIMPLE_TAX_TABLE_2024} 제6호 첫 행 770천원`),
    'wageIncomeTax.simpleTaxStrategy': unverified(
      `docs/design/review.md D4: 간이세액은 공식 표 대신 산식(MIDPOINT_FORMULA)으로 구해 표 금액과 다를 수 있습니다(300만원·1명 공식 74,350원). 계수는 확인했지만 결과는 추정치입니다`,
    ),
    'wageIncomeTax.taxRoundingUnit': confirmed(
      `국고금관리법 제47조제1항: 국고금 수입의 10원 미만 끝수는 계산하지 않음. ${law('국고금관리법', '제47조')}`,
    ),
    'localIncomeTax.ratePpm': confirmed(`${SPEC} §4.2`),
    'localIncomeTax.roundingUnit': confirmed(
      `지방회계법 제55조: 지방자치단체 수입의 10원 미만은 계산하지 않을 수 있음. ${law('지방회계법', '제55조')}`,
    ),
    'dailyWorker.dailyDeduction': confirmed(`소득세법 제47조제2항: 일용근로자 공제액 1일 15만원; ${SPEC} §4.3`),
    'dailyWorker.ratePpm': confirmed(`${SPEC} §4.3`),
    'dailyWorker.creditPpm': confirmed(`소득세법 제59조제3항: 일용근로자 산출세액의 100분의 55; ${SPEC} §4.3`),
    'dailyWorker.socialInsuranceMinDays': confirmed(`${SPEC} §4.1 (bundle DAILY_WORKER exclusion text)`),
    'dailyWorker.socialInsuranceMinHours': confirmed(`${SPEC} §4.1 (bundle DAILY_WORKER exclusion text)`),
    'businessIncome.ratePpm': confirmed(`${SPEC} §4.4`),
    'otherIncome.ratePpm': confirmed(`${SPEC} §4.5`),
    'otherIncome.minimumTaxableIncome': confirmed(`${SPEC} §4.5 (과세최저한 5만원)`),
    smallAmountExemption: confirmed(`${SPEC} §4.3, §4.4`),
    'nonTaxable.MEAL': confirmed(`소득세법 제12조제3호러목: 월 20만원 이하의 식사대. ${law('소득세법', '제12조')}`),
    'nonTaxable.VEHICLE': confirmed(
      `소득세법 시행령 제12조제3호: 자가운전보조금 월 20만원 이내. ${law('소득세법시행령', '제12조')}`,
    ),
    'nonTaxable.CHILDCARE': confirmed(
      `소득세법 제12조제3호머목2)(법률 제21221호, 2025. 12. 23. 개정, 2026. 1. 1. 이후 지급분): 과세기간 개시일 현재 6세 이하 자녀 보육수당 "해당 자녀 1명당" 월 20만원 이내. monthlyLimit은 자녀 1명당 한도(perChild)이고 엔진이 대상 자녀 수를 곱합니다. ${law('소득세법', '제12조')}`,
    ),
    'nonTaxable.RESEARCH': confirmed(
      `소득세법 시행령 제12조제12호: 연구보조비·연구활동비 월 20만원 이내. ${law('소득세법시행령', '제12조')}`,
    ),
    'nonTaxable.OVERSEAS': confirmed(
      `소득세법 시행령 제16조제1항제1호: 국외근로 보수 월 100만원 이내. ${law('소득세법시행령', '제16조')}`,
    ),
    'nonTaxable.OVERSEAS_SPECIAL': confirmed(
      `소득세법 시행령 제16조제1항제1호: 원양어업 선박·국외 항행 선박·국외 건설현장 등 월 500만원 이내. ${law('소득세법시행령', '제16조')}`,
    ),
    'nonTaxable.NIGHT_SHIFT': confirmed(
      `소득세법 시행령 제17조제2항제1호: 생산직 연장·야간·휴일근로 수당 연 240만원 이하. 월정액급여 260만원 이하·직전 총급여 3,700만원 이하 요건(제17조제1항)은 엔진 밖. ${law('소득세법시행령', '제17조')}`,
    ),
    'nonTaxable.PARENTAL_LEAVE': confirmed(
      `소득세법 제12조제3호마목: 고용보험법에 따른 육아휴직 급여 등 전액. ${law('소득세법', '제12조')}`,
    ),
    'nonTaxable.TUITION': confirmed(
      `소득세법 시행령 제11조: 요건을 갖춘 학자금은 해당 과세기간에 납입할 금액이 한도이고 고정 금액 한도는 없습니다. ${law('소득세법시행령', '제11조')}`,
    ),
    'nonTaxable.INVENTION': confirmed(
      `소득세법 시행령 제17조의3제1항(2024. 2. 29. 개정): 직무발명보상금 연 700만원 이하. ${law('소득세법시행령', '제17조의3')}`,
    ),
    'retirementIncomeTax.serviceYearDeduction': confirmed(
      `소득세법 제48조제1항제1호 근속연수공제(2022. 12. 31. 개정). ${law('소득세법', '제48조')}`,
    ),
    'retirementIncomeTax.convertedPayDeduction': confirmed(
      `소득세법 제48조제1항제2호 환산급여공제. ${law('소득세법', '제48조')}`,
    ),
  },
}

/**
 * 근로소득 간이세액표가 바뀌는 2026년 3월부터의 기준표입니다.
 *
 * 소득세법 시행령 별표 2가 2026. 2. 27. 개정(대통령령 제36129호)되어 2026. 3. 1. 이후 원천징수분부터
 * 8~20세 자녀 공제액이 바뀝니다(부칙 제15조). 특별소득공제 계산식, 월급여액 구간, 1천만원 초과 산식은 같습니다.
 */
export const RATES_2026_03: PayrollRateTable = {
  ...RATES_2026_01,
  effectiveFrom: '2026-03',
  wageIncomeTax: {
    ...RATES_2026_01.wageIncomeTax,
    childCreditMonthly: { one: 20_830, two: 45_830, perAdditional: 33_330 },
  },
  verification: {
    ...RATES_2026_01.verification,
    'wageIncomeTax.specialDeductionByDependants': confirmed(`${SIMPLE_TAX_TABLE_2026} 제1호 계산식`),
    'wageIncomeTax.childCreditMonthly': confirmed(
      `${SIMPLE_TAX_TABLE_2026} 제3호: 8~20세 자녀 1명 20,830원, 2명 45,830원, 3명 이상 45,830원 + 2명 초과 1명당 33,330원`,
    ),
    'wageIncomeTax.highIncomeThreshold': confirmed(`${SIMPLE_TAX_TABLE_2026} 제6호 "10,000천원 초과" 산식`),
    'wageIncomeTax.highIncomeBrackets': confirmed(`${SIMPLE_TAX_TABLE_2026} 제6호 10,000천원 초과 구간`),
    'wageIncomeTax.tableRowBands': confirmed(`${SIMPLE_TAX_TABLE_2026} 제6호 월급여액 구간`),
    'wageIncomeTax.tableMinimumPay': confirmed(`${SIMPLE_TAX_TABLE_2026} 제6호 첫 행 770천원`),
  },
}

/**
 * 국민연금 기준소득월액 상하한이 바뀌는 2026년 7월부터의 기준표입니다.
 *
 * 보건복지부고시 제2026-31호(2026. 2. 2., 2026. 7. 1. 시행): 하한 410천원, 상한 6,590천원, 2026년 7월분~2027년 6월분.
 */
export const RATES_2026_07: PayrollRateTable = {
  ...RATES_2026_03,
  effectiveFrom: '2026-07',
  nationalPension: { ...RATES_2026_03.nationalPension, baseMin: 410_000, baseMax: 6_590_000 },
  verification: {
    ...RATES_2026_03.verification,
    'nationalPension.baseMin': confirmed(
      `보건복지부고시 제2026-31호(2026. 2. 2., 2026. 7. 1. 시행) 하한액 410천원, 2026년 7월분~2027년 6월분. ${notice('국민연금기준소득월액하한액과상한액')}`,
    ),
    'nationalPension.baseMax': confirmed(
      `보건복지부고시 제2026-31호(2026. 2. 2., 2026. 7. 1. 시행) 상한액 6,590천원, 2026년 7월분~2027년 6월분. ${notice('국민연금기준소득월액하한액과상한액')}`,
    ),
  },
}

/**
 * 장기요양 비율의 반올림이 법으로 정해지는 2026년 11월부터의 기준표입니다.
 *
 * 노인장기요양보험법 제9조제1항(법률 제21690호, 2026. 5. 26. 개정, 2026. 11. 27. 시행)은 건강보험료율 대비
 * 장기요양보험료율의 비율을 소수점 이하 다섯째자리에서 반올림합니다. 부칙 제3조로 시행일이 속하는 달의
 * 장기요양보험료부터 적용하므로 2026. 11. 귀속분부터 0.9448 ÷ 7.19 = 0.131404… → 0.1314(131,400ppm)입니다.
 * 값은 2026. 1~10월(보건복지부 보도자료의 13.14%)과 같고 출처만 법률로 바뀝니다. 4대보험은 귀속월 기준표를 씁니다.
 */
export const RATES_2026_11: PayrollRateTable = {
  ...RATES_2026_07,
  effectiveFrom: '2026-11',
  verification: {
    ...RATES_2026_07.verification,
    'longTermCare.ratioOfHealthPpm': confirmed(
      `노인장기요양보험법 제9조제1항(법률 제21690호, 2026. 5. 26. 개정, 2026. 11. 27. 시행): 건강보험료율 대비 장기요양보험료율의 비율을 ` +
        `소수점 이하 다섯째자리에서 반올림. 부칙 제3조: 시행일이 속하는 달의 장기요양보험료부터 적용. ` +
        `시행령 제4조 100만분의 9,448 ÷ 국민건강보험법 시행령 제44조 1만분의 719 = 0.131404… → 0.1314. ${law('노인장기요양보험법', '제9조')}`,
    ),
  },
}

/** 내장 기준표 전체입니다. 오래된 것부터이고, 기준표 저장소의 초기 데이터로 씁니다. */
export const BUILT_IN_RATE_TABLES: readonly PayrollRateTable[] = [
  RATES_2026_01,
  RATES_2026_03,
  RATES_2026_07,
  RATES_2026_11,
]
