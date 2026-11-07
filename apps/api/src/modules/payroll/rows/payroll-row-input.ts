import { Schema } from 'effect'
import { CHILDCARE_CHILDREN_MAX } from '../engine/non-taxable.ts'
import { CalendarDate, Minutes, Won } from '../payroll-schema.ts'

const NonTaxableCategory = Schema.Literals([
  'MEAL',
  'VEHICLE',
  'CHILDCARE',
  'RESEARCH',
  'OVERSEAS',
  'OVERSEAS_SPECIAL',
  'NIGHT_SHIFT',
  'PARENTAL_LEAVE',
  'TUITION',
  'INVENTION',
])

const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
const PositiveCount = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)))
const TaxDeductionMode = Schema.Literals(['BEFORE_TAX', 'AFTER_TAX'])

/** 근로 행의 지급 항목입니다. 기본급 외 수당·비과세 항목입니다. */
export const PaymentItemSchema = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
  amount: Won,
  nonTaxableCategory: Schema.optionalKey(NonTaxableCategory),
  /** 회사가 정한 비과세 한도입니다. 법정 한도와 작은 쪽을 씁니다. */
  companyNonTaxableLimit: Schema.optionalKey(Won),
  includeInOrdinaryWage: Schema.optionalKey(Schema.Boolean),
  includeInMinimumWage: Schema.optionalKey(Schema.Boolean),
  /** 기본급과 함께 일할계산하는지입니다. */
  prorate: Schema.optionalKey(Schema.Boolean),
})

/** 회사 공제 항목(선지급금·동호회비 등)입니다. */
export const OtherDeductionSchema = Schema.Struct({ code: Schema.String, name: Schema.String, amount: Won })

/** 근무 시트입니다. 모두 분 단위 정수입니다. */
export const WorkMinutesSchema = Schema.Struct({
  regularMinutes: Schema.optionalKey(Minutes),
  overtimeMinutes: Schema.optionalKey(Minutes),
  nightMinutes: Schema.optionalKey(Minutes),
  holidayMinutes: Schema.optionalKey(Minutes),
  holidayOvertimeMinutes: Schema.optionalKey(Minutes),
  absenceMinutes: Schema.optionalKey(Minutes),
  weeklyHolidayDeductionDays: Schema.optionalKey(Count),
})

/** 4대보험 공제 방식이 `NOTICE`일 때 쓰는 공단 고지액입니다. 없는 보험은 고지액 0으로 봅니다. */
export const InsuranceNoticeSchema = Schema.Struct({
  nationalPension: Schema.optionalKey(Won),
  healthInsurance: Schema.optionalKey(Won),
  longTermCare: Schema.optionalKey(Won),
  employmentInsurance: Schema.optionalKey(Won),
})

const wageFields = {
  paymentItems: Schema.optionalKey(Schema.Array(PaymentItemSchema)),
  work: Schema.optionalKey(WorkMinutesSchema),
  insuranceNotice: Schema.optionalKey(InsuranceNoticeSchema),
  otherDeductions: Schema.optionalKey(Schema.Array(OtherDeductionSchema)),
}

/** 월급제 근로 행 입력입니다. */
export const MonthlyWageInput = Schema.Struct({
  incomeType: Schema.Literal('WAGE_MONTHLY'),
  basePay: Won,
  /** 중도 입·퇴사 일할계산입니다. 없으면 한 달 전체입니다. */
  proration: Schema.optionalKey(
    Schema.Struct({
      method: Schema.Literals(['CALENDAR_DAYS', 'SCHEDULED_DAYS']),
      payableDays: Count,
      totalDays: PositiveCount,
    }),
  ),
  ...wageFields,
})

/** 시급제 근로 행 입력입니다. */
export const HourlyWageInput = Schema.Struct({
  incomeType: Schema.Literal('WAGE_HOURLY'),
  hourlyWage: Won,
  weeklyHolidayWeeks: Schema.optionalKey(Count),
  ...wageFields,
})

/** 일급제 근로 행 입력입니다. 일용근로소득과 다릅니다. */
export const DailyWageInput = Schema.Struct({
  incomeType: Schema.Literal('WAGE_DAILY'),
  dailyWage: Won,
  workedDays: Count,
  weeklyHolidayWeeks: Schema.optionalKey(Count),
  ...wageFields,
})

/** 일용근로소득 행 입력입니다. */
export const DailyWorkerInput = Schema.Struct({
  incomeType: Schema.Literal('DAILY'),
  payAmount: Won,
  workDays: PositiveCount,
  /** 1일 평균 근무시간(분)입니다. 4대보험 가입 기준 판정에 씁니다. */
  averageDailyMinutes: Schema.optionalKey(Minutes),
  /** 사업주·동거친족이라 고용보험을 빼는지입니다. */
  employmentInsuranceExempt: Schema.optionalKey(Schema.Boolean),
  otherDeductions: Schema.optionalKey(Schema.Array(OtherDeductionSchema)),
})

/** 사업소득 행 입력입니다. */
export const BusinessIncomeInput = Schema.Struct({
  incomeType: Schema.Literal('BUSINESS'),
  payAmount: Won,
  /** 업종코드입니다. 예: `940909` 기타인적용역자(현행 화면의 "기타자영업(프리랜서)"). */
  businessIncomeCode: Schema.optionalKey(Schema.String),
  taxDeductionMode: Schema.optionalKey(TaxDeductionMode),
  /** 예술인·노무제공자 고용보험 대상인지입니다. */
  employmentInsuranceApplicable: Schema.optionalKey(Schema.Boolean),
  otherDeductions: Schema.optionalKey(Schema.Array(OtherDeductionSchema)),
})

/** 기타소득 행 입력입니다. */
export const OtherIncomeInput = Schema.Struct({
  incomeType: Schema.Literal('OTHER'),
  payAmount: Won,
  /** 지급사유 코드입니다. 없으면 `76`(강연료 등, 의제 필요경비 60%)입니다. */
  otherIncomeCode: Schema.optionalKey(Schema.String),
  /** 실제 필요경비입니다. 있으면 의제 경비율 대신 씁니다. */
  necessaryExpenseAmount: Schema.optionalKey(Won),
  taxDeductionMode: Schema.optionalKey(TaxDeductionMode),
  otherDeductions: Schema.optionalKey(Schema.Array(OtherDeductionSchema)),
})

/** 급여대장 행과 계산기의 입력입니다. `incomeType`으로 구분합니다. */
export const PayrollRowInputSchema = Schema.Union([
  MonthlyWageInput,
  HourlyWageInput,
  DailyWageInput,
  DailyWorkerInput,
  BusinessIncomeInput,
  OtherIncomeInput,
])

/** {@link PayrollRowInputSchema}의 값입니다. */
export type PayrollRowInputValue = typeof PayrollRowInputSchema.Type

/** 근로소득 행의 간이세액·4대보험 입력입니다. 급여대장은 HR에서 받아 스냅숏으로, 계산기는 본문으로 받습니다. */
export const EmployeeSnapshotSchema = Schema.Struct({
  dependants: PositiveCount,
  childrenAged8To20: Count,
  /**
   * 보육수당 비과세 대상 자녀 수(과세기간 개시일 현재 6세 이하, 0–20)입니다. 보육수당 월 한도 = 20만원 × 이 값입니다.
   * 없으면 모르는 값이라 1명으로 보고 경고합니다. 이 값을 넣기 전에 저장한 스냅숏에는 없습니다.
   */
  childcareChildren: Schema.optionalKey(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      Schema.check(Schema.isLessThanOrEqualTo(CHILDCARE_CHILDREN_MAX)),
    ),
  ),
  /** 자녀 수를 정한 HR 설정의 적용 시작일입니다. 귀속월과 해가 다르면 `CHILDCARE_CHILDREN_STALE` 경고를 붙입니다. */
  childcareChildrenEffectiveFrom: Schema.optionalKey(CalendarDate),
  withholdingRatePpm: Schema.Literals([800_000, 1_000_000, 1_200_000]),
  manualIncomeTax: Schema.NullOr(Won),
  socialInsurance: Schema.Struct({
    nationalPension: Schema.Boolean,
    healthInsurance: Schema.Boolean,
    employmentInsurance: Schema.Boolean,
  }),
  monthlyStandardHours: PositiveCount,
  dailyRestMinutes: Minutes,
})

/** {@link EmployeeSnapshotSchema}의 값입니다. */
export type EmployeeSnapshot = typeof EmployeeSnapshotSchema.Type

/** 계산 결과의 줄입니다. */
const LineSchema = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
  amount: Schema.Int,
  formula: Schema.String,
})

const PremiumsSchema = Schema.Struct({
  nationalPension: Won,
  healthInsurance: Won,
  longTermCare: Won,
  employmentInsurance: Won,
  industrialAccident: Won,
  total: Won,
})

/** 행 계산 결과입니다. 금액 셀의 `fx` 설명은 `breakdown`입니다. */
export const PayrollRowResultSchema = Schema.Struct({
  /** 4대보험에 쓴 기준표(귀속월)입니다. */
  rateTable: Schema.String,
  /** 원천세에 쓴 기준표(지급월)입니다. */
  withholdingRateTable: Schema.String,
  payments: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      name: Schema.String,
      amount: Schema.Int,
      taxableAmount: Schema.Int,
      nonTaxableAmount: Schema.Int,
      formula: Schema.String,
    }),
  ),
  grossPay: Schema.Int,
  taxablePay: Schema.Int,
  nonTaxablePay: Schema.Int,
  employeeInsurance: PremiumsSchema,
  employerInsurance: PremiumsSchema,
  incomeTax: Won,
  localIncomeTax: Won,
  deductions: Schema.Array(LineSchema),
  deductionTotal: Schema.Int,
  netPay: Schema.Int,
  breakdown: Schema.Array(
    Schema.Struct({ code: Schema.String, label: Schema.String, amount: Schema.Int, formula: Schema.String }),
  ),
  warnings: Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String })),
})

/** {@link PayrollRowResultSchema}의 값입니다. */
export type PayrollRowResultValue = typeof PayrollRowResultSchema.Type
