import type { NonTaxableCategory, PayrollRateTable, YearMonth } from './rate-table.types.ts'

/** 계산 한 단계입니다. 금액 셀의 `fx` 아이콘과 명세서에 보여 줍니다. */
export interface TraceEntry {
  code: string
  label: string
  amount: number
  /** 실제 피연산자를 넣은 계산식입니다. 예: `3,000,000 × 4.75%` */
  formula: string
}

/** 4대보험 공제 방식입니다. 요율로 계산(`RATE`), 공단 고지액(`NOTICE`), 공제하지 않음(`EXEMPT`)입니다. */
export type InsuranceMode = 'RATE' | 'NOTICE' | 'EXEMPT'

/** 행 하나의 보험별 공제 설정입니다. */
export interface InsuranceSetting {
  mode: InsuranceMode
  /** `NOTICE`일 때 쓰는 근로자 고지액입니다. */
  noticeAmount?: number
  /** 사업주 고지액입니다. 국민연금·건강보험은 없으면 근로자 고지액과 같습니다. */
  employerNoticeAmount?: number
}

/** {@link calculateSocialInsurance}의 입력입니다. */
export interface SocialInsuranceInput {
  /** 보험료 대상 보수(월)입니다. 보통 과세 급여입니다. */
  insurablePay: number
  nationalPension: InsuranceSetting & {
    /** 신고한 기준소득월액입니다. 없으면 `insurablePay`입니다. */
    baseMonthlyIncome?: number
  }
  healthInsurance: InsuranceSetting & {
    /** 신고한 보수월액입니다. 없으면 `insurablePay`입니다. */
    baseMonthlyIncome?: number
    /** 건강보험이 `NOTICE`일 때의 장기요양 고지액입니다. */
    longTermCareNoticeAmount?: number
  }
  employmentInsurance: InsuranceSetting & {
    /** `ARTIST`는 예술인·노무제공자 근로자 요율을 씁니다. */
    kind?: 'STANDARD' | 'ARTIST'
  }
  /** 산재보험 사업주 요율(ppm)입니다. 없으면 기준표 기본값입니다. */
  industrialAccidentRatePpm?: number
  /** 고용안정·직업능력개발 사업주 요율(ppm)입니다. 회사 규모마다 다릅니다. */
  employerStabilityRatePpm?: number
}

/** 한쪽(근로자 또는 사업주)의 4대보험료입니다. */
export interface InsurancePremiums {
  nationalPension: number
  healthInsurance: number
  longTermCare: number
  employmentInsurance: number
  /** 근로자 쪽은 항상 0입니다. */
  industrialAccident: number
  total: number
}

/** {@link calculateSocialInsurance}의 결과입니다. */
export interface SocialInsuranceResult {
  employee: InsurancePremiums
  employer: InsurancePremiums
  trace: TraceEntry[]
}

/** 간이세액 계산 입력입니다. */
export interface SimpleTaxInput {
  /** 비과세를 뺀 월 과세 급여입니다. */
  monthlyTaxablePay: number
  /** 본인을 포함한 공제대상가족 수입니다. 1 이상입니다. */
  dependants: number
  /** 공제대상가족 중 8~20세 자녀 수입니다. */
  childrenAged8To20: number
}

/**
 * 원천징수 비율을 곱하기 전의 월 간이세액을 구하는 방법입니다.
 *
 * 내장 전략은 {@link EXACT_FORMULA}, {@link MIDPOINT_FORMULA}, {@link lookupSimpleTaxTable}입니다.
 * 공식 간이세액표를 넣은 전략으로 바꿔도 호출하는 쪽은 바뀌지 않습니다.
 */
export interface SimpleTaxStrategy {
  name: string
  monthlyTax(input: SimpleTaxInput, rates: PayrollRateTable): number
}

/** 근로소득세 원천징수 방법입니다. 간이세액표(`TAX_TABLE`), 직접 입력(`MANUAL`), 미적용(`NONE`)입니다. */
export type IncomeTaxMethod = 'TAX_TABLE' | 'MANUAL' | 'NONE'

/** 행 하나의 근로소득세 설정입니다. */
export interface WageIncomeTaxSetting {
  method: IncomeTaxMethod
  dependants: number
  childrenAged8To20: number
  /** 근로자가 고른 원천징수 비율(ppm)입니다. 80%·100%·120% 중 하나입니다. */
  withholdingRatePpm: number
  /** `MANUAL`일 때 손으로 넣은 소득세입니다. */
  manualAmount?: number
  /** 매월 반영하는 중소기업 취업자 감면입니다. */
  reduction?: { ratePpm: number; remainingAnnualLimit: number }
}

/** 근로 행의 지급 항목입니다. 기본급·수당·비과세 항목입니다. */
export interface PaymentItemInput {
  code: string
  name: string
  amount: number
  /** 법정 비과세 유형입니다. 과세 항목은 없습니다. */
  nonTaxableCategory?: NonTaxableCategory
  /** 이미 분류한 금액이라 한도 없이 전액 비과세로 봅니다. */
  preclassifiedNonTaxable?: boolean
  /** 회사가 정한 비과세 한도입니다. 법정 한도와 작은 쪽을 씁니다. */
  companyNonTaxableLimit?: number
  /** 올해 이미 쓴 같은 유형의 비과세 금액입니다. 연 한도에 씁니다. */
  annualNonTaxableUsed?: number
  includeInOrdinaryWage?: boolean
  includeInMinimumWage?: boolean
  /** 기본급과 함께 일할계산하는 항목인지입니다. */
  prorate?: boolean
}

/** 비과세 한도를 적용한 지급 줄입니다. */
export interface PaymentLine {
  code: string
  name: string
  amount: number
  taxableAmount: number
  nonTaxableAmount: number
  formula: string
}

/** 공제 줄입니다. 4대보험, 세금, 회사 공제 항목입니다. */
export interface DeductionLine {
  code: string
  name: string
  amount: number
  formula: string
}

/** 행에 넣은 회사 공제 항목입니다. 선지급금, 동호회비 등입니다. */
export interface OtherDeductionInput {
  code: string
  name: string
  amount: number
}

/** 연장·야간·휴일·휴일연장 지급배수(ppm)입니다. 1.5배는 `1_500_000`입니다. 급여 설정에서 옵니다. */
export interface PremiumMultipliers {
  overtimeRatePpm: number
  nightRatePpm: number
  holidayRatePpm: number
  holidayOvertimeRatePpm: number
}

/** 근무 시트의 월 근무 시간입니다. 모두 분 단위 정수입니다. */
export interface WorkMinutesInput {
  /** 시급제의 기본 시간입니다. */
  regularMinutes?: number
  overtimeMinutes?: number
  nightMinutes?: number
  holidayMinutes?: number
  holidayOvertimeMinutes?: number
  /** 월급제에서 빼는 지각·조퇴·결근 시간입니다. */
  absenceMinutes?: number
  /** 결근으로 주휴를 잃은 일수입니다(월급제). 1일 주휴시간만큼 공제합니다. */
  weeklyHolidayDeductionDays?: number
}

/** 일할계산 방식입니다. 역일(`CALENDAR_DAYS`) 또는 소정근로일(`SCHEDULED_DAYS`)로 나눕니다. */
export type ProrationMethod = 'CALENDAR_DAYS' | 'SCHEDULED_DAYS'

/** 월 단위 항목의 일할계산 입력입니다. */
export interface ProrationInput {
  method: ProrationMethod
  /** 기간 안에서 재직하고 급여를 받는 일수입니다. */
  payableDays: number
  /** 그 달 역일수, 또는 `SCHEDULED_DAYS`면 소정근로일수입니다. */
  totalDays: number
}

interface WageRowBase {
  attributionMonth: YearMonth
  paymentItems: readonly PaymentItemInput[]
  work?: WorkMinutesInput
  multipliers: PremiumMultipliers
  /** 유급 주휴를 포함한 월 소정근로시간입니다. 주 40시간이면 209입니다. */
  monthlyStandardHours: number
  /** 1일 주휴시간(분)입니다. 주휴수당과 주휴공제에 씁니다. 없으면 480분입니다. */
  dailyRestMinutes?: number
  insurance: Omit<SocialInsuranceInput, 'insurablePay'>
  incomeTax: WageIncomeTaxSetting
  /**
   * 보육수당(`CHILDCARE`) 비과세 대상 자녀 수입니다. 과세기간 개시일(1월 1일) 현재 6세 이하 자녀입니다.
   * 보육수당 월 한도는 법정 한도 × 이 값이고, 0명이면 비과세가 없습니다. 없으면 모르는 값이라 1명으로 보고
   * `CHILDCARE_CHILDREN_UNKNOWN` 경고를 붙입니다(자녀 수를 받기 전과 같은 한도).
   */
  childcareChildren?: number
  otherDeductions?: readonly OtherDeductionInput[]
}

/** 월급제 근로 행입니다. */
export interface MonthlyWageRowInput extends WageRowBase {
  incomeType: 'WAGE_MONTHLY'
  basePay: number
  proration?: ProrationInput
}

/** 시급제 근로 행입니다. */
export interface HourlyWageRowInput extends WageRowBase {
  incomeType: 'WAGE_HOURLY'
  hourlyWage: number
  /** 주휴수당을 받는 주 수입니다(소정근로일 개근, 주 15시간 이상). */
  weeklyHolidayWeeks?: number
}

/** 일급제 근로 행입니다. 일용근로소득과 다릅니다. */
export interface DailyWageRowInput extends WageRowBase {
  incomeType: 'WAGE_DAILY'
  dailyWage: number
  workedDays: number
  /** 시간당 임금을 구할 1일 소정근로시간(분)입니다. 없으면 480분입니다. */
  dailyContractualMinutes?: number
  weeklyHolidayWeeks?: number
}

/** 근로 행입니다. */
export type WageRowInput = MonthlyWageRowInput | HourlyWageRowInput | DailyWageRowInput

/** 일용근로소득 행입니다. */
export interface DailyWorkerRowInput {
  incomeType: 'DAILY'
  attributionMonth: YearMonth
  /** 행의 지급 총액입니다. */
  payAmount: number
  workDays: number
  /** 근무일별 지급액입니다. 없으면 총액을 균등 분할합니다. */
  dailyPays?: readonly number[]
  /** 1일 평균 근무시간(분)입니다. 4대보험 가입 기준 판정에 씁니다. */
  averageDailyMinutes?: number
  insurance: Omit<SocialInsuranceInput, 'insurablePay'>
  otherDeductions?: readonly OtherDeductionInput[]
}

/** 지급액이 세전(`BEFORE_TAX`)인지, 역산할 세후 금액(`AFTER_TAX`)인지입니다. */
export type TaxDeductionMode = 'BEFORE_TAX' | 'AFTER_TAX'

/** 사업소득 행입니다. */
export interface BusinessRowInput {
  incomeType: 'BUSINESS'
  attributionMonth: YearMonth
  payAmount: number
  taxDeductionMode?: TaxDeductionMode
  /** 예술인·노무제공자 고용보험입니다. */
  employmentInsurance?: { applicable: boolean; insurableEarnings?: number }
  otherDeductions?: readonly OtherDeductionInput[]
}

/** 기타소득 필요경비를 정하는 방법입니다. 의제 경비율 또는 실제 경비입니다. */
export type NecessaryExpense = { kind: 'DEEMED'; ratePpm: number } | { kind: 'ACTUAL'; amount: number }

/** 기타소득 행입니다. */
export interface OtherIncomeRowInput {
  incomeType: 'OTHER'
  attributionMonth: YearMonth
  payAmount: number
  necessaryExpense: NecessaryExpense
  /** 소득세율(ppm)입니다. 없으면 기준표의 20%입니다. */
  taxRatePpm?: number
  taxDeductionMode?: TaxDeductionMode
  otherDeductions?: readonly OtherDeductionInput[]
}

/** {@link calculatePayrollRow}의 입력입니다. `incomeType`으로 구분합니다. */
export type PayrollRowInput = WageRowInput | DailyWorkerRowInput | BusinessRowInput | OtherIncomeRowInput

/** 급여 행의 소득 구분입니다. */
export type PayrollIncomeType = PayrollRowInput['incomeType']

/** {@link calculatePayrollRow}의 선택 입력입니다. */
export interface PayrollRowOptions {
  /** 간이세액 전략입니다. 없으면 {@link MIDPOINT_FORMULA}입니다. */
  simpleTax?: SimpleTaxStrategy
}

/** 계산을 막지 않는 경고 코드입니다. */
export type PayrollWarningCode =
  | 'BELOW_MINIMUM_WAGE'
  | 'NON_TAXABLE_LIMIT_EXCEEDED'
  | 'CHILDCARE_CHILDREN_UNKNOWN'
  | 'DAILY_WORKER_SOCIAL_INSURANCE_REQUIRED'

/** 계산 결과에 붙는 경고입니다. 저장을 막지 않습니다. */
export interface PayrollWarning {
  code: PayrollWarningCode
  message: string
}

/** {@link calculatePayrollRow}의 결과입니다. */
export interface PayrollRowResult {
  incomeType: PayrollIncomeType
  attributionMonth: YearMonth
  /** 계산에 쓴 기준표의 적용 시작월입니다. */
  rateTable: YearMonth
  payments: PaymentLine[]
  grossPay: number
  taxablePay: number
  nonTaxablePay: number
  insurance: SocialInsuranceResult
  incomeTax: number
  localIncomeTax: number
  deductions: DeductionLine[]
  deductionTotal: number
  netPay: number
  /** 사업주 부담 4대보험 합계입니다. 인건비 보고서에 씁니다. */
  employerInsuranceTotal: number
  breakdown: TraceEntry[]
  warnings: PayrollWarning[]
}

/** {@link calculateSeverancePay}의 입력입니다. 날짜는 `YYYY-MM-DD`입니다. */
export interface SeveranceInput {
  joinDate: string
  /** 마지막 근무일입니다. 퇴직일(산정사유 발생일)은 그다음 날입니다. */
  lastWorkDate: string
  /** 퇴직일 이전 3개 역월에 지급한 임금입니다. */
  threeMonthWages: number
  /** 그 3개월의 일수입니다. 없으면 {@link averageWagePeriodDays}입니다. */
  threeMonthDays?: number
  /** 최근 12개월 상여 총액입니다. 3/12을 더합니다. */
  annualBonus?: number
  /** 전년도 미사용 연차수당입니다. 3/12을 더합니다. */
  annualLeavePay?: number
  /** 1일 통상임금입니다. 평균임금보다 높으면 이것을 씁니다. */
  ordinaryDailyWage?: number
}

/** {@link calculateSeverancePay}의 결과입니다. */
export interface SeveranceResult {
  eligible: boolean
  serviceDays: number
  averageDailyWage: number
  /** 통상임금(일)이 더 낮은 평균임금을 대신했는지입니다. */
  usedOrdinaryWage: boolean
  severancePay: number
  retirementIncomeTax: number
  localIncomeTax: number
  netPay: number
  breakdown: TraceEntry[]
}
