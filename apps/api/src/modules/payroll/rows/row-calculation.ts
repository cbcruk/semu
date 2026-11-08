import type {
  InsuranceSetting,
  PayrollRowInput,
  PayrollRowResult,
  PayrollWarning,
  PremiumMultipliers,
  WageIncomeTaxSetting,
} from '../engine/engine.types.ts'
import { calculatePayrollRow } from '../engine/payroll-row.ts'
import type { PayrollRateTable } from '../engine/rate-table.types.ts'
import {
  ARTWORK_CODE,
  ARTWORK_FULL_RATE_LIMIT,
  DEFAULT_OTHER_INCOME_CODE,
  findOtherIncomeCode,
} from '../rate-tables/reference-codes.ts'
import type { PayrollSettingRecord } from '../settings/payroll-setting.types.ts'
import type { EmployeeSnapshot, PayrollRowInputValue, PayrollRowResultValue } from './payroll-row-input.ts'

/**
 * HR 정보가 없는 근로 행에 쓰는 기본값입니다. 현행 `DEFAULT_SNAPSHOT`(본인 1인, 4대보험 모두, 209시간, 주휴 8시간)입니다.
 * 보육수당 대상 자녀 수(`childcareChildren`)는 모르는 값이라 비워 둡니다.
 */
export const DEFAULT_EMPLOYEE_SNAPSHOT: EmployeeSnapshot = {
  dependants: 1,
  childrenAged8To20: 0,
  withholdingRatePpm: 1_000_000,
  manualIncomeTax: null,
  socialInsurance: { nationalPension: true, healthInsurance: true, employmentInsurance: true },
  monthlyStandardHours: 209,
  dailyRestMinutes: 480,
}

/** 행 하나를 계산하는 데 필요한 회사 설정과 기준표입니다. */
export interface RowCalculationContext {
  attributionMonth: string
  /** 귀속월 기준표입니다. 4대보험에 씁니다. */
  attributionRates: PayrollRateTable
  /** 지급월 기준표입니다. 원천세에 씁니다. */
  paymentRates: PayrollRateTable
  setting: Pick<PayrollSettingRecord, 'multipliers' | 'deductionMethods'>
}

/**
 * 와이어 입력을 엔진 입력으로 바꿉니다. 근로 행은 직원 스냅숏과 회사 공제 방식을 함께 씁니다.
 */
export function engineInputOf(
  input: PayrollRowInputValue,
  snapshot: EmployeeSnapshot | null,
  context: RowCalculationContext,
): PayrollRowInput {
  const attributionMonth = context.attributionMonth
  switch (input.incomeType) {
    case 'WAGE_MONTHLY':
    case 'WAGE_HOURLY':
    case 'WAGE_DAILY': {
      const 직원정보사본 = snapshot ?? DEFAULT_EMPLOYEE_SNAPSHOT
      const 산출방법 = context.setting.deductionMethods
      const 고지금액 = input.insuranceNotice ?? {}
      const 공통입력 = {
        attributionMonth,
        paymentItems: (input.paymentItems ?? []).map((item) => ({ ...item })),
        work: { ...input.work },
        multipliers: { ...context.setting.multipliers } satisfies PremiumMultipliers,
        monthlyStandardHours: 직원정보사본.monthlyStandardHours,
        dailyRestMinutes: 직원정보사본.dailyRestMinutes,
        insurance: {
          nationalPension: 보험설정(
            직원정보사본.socialInsurance.nationalPension,
            산출방법.nationalPension,
            고지금액.nationalPension,
          ),
          healthInsurance: {
            ...보험설정(
              직원정보사본.socialInsurance.healthInsurance,
              산출방법.healthInsurance,
              고지금액.healthInsurance,
            ),
            ...(고지금액.longTermCare === undefined ? {} : { longTermCareNoticeAmount: 고지금액.longTermCare }),
          },
          employmentInsurance: 보험설정(
            직원정보사본.socialInsurance.employmentInsurance,
            산출방법.employmentInsurance,
            고지금액.employmentInsurance,
          ),
        },
        incomeTax: 소득세설정(직원정보사본, 산출방법.incomeTax),
        ...(직원정보사본.childcareChildren === undefined ? {} : { childcareChildren: 직원정보사본.childcareChildren }),
        ...(직원정보사본.childcareChildrenEffectiveFrom === undefined
          ? {}
          : { childcareChildrenEffectiveFrom: 직원정보사본.childcareChildrenEffectiveFrom }),
        otherDeductions: (input.otherDeductions ?? []).map((line) => ({ ...line })),
      }
      if (input.incomeType === 'WAGE_HOURLY') {
        return {
          ...공통입력,
          incomeType: 'WAGE_HOURLY',
          hourlyWage: input.hourlyWage,
          ...(input.weeklyHolidayWeeks === undefined ? {} : { weeklyHolidayWeeks: input.weeklyHolidayWeeks }),
        }
      }
      if (input.incomeType === 'WAGE_DAILY') {
        return {
          ...공통입력,
          incomeType: 'WAGE_DAILY',
          dailyWage: input.dailyWage,
          workedDays: input.workedDays,
          ...(input.weeklyHolidayWeeks === undefined ? {} : { weeklyHolidayWeeks: input.weeklyHolidayWeeks }),
        }
      }
      return {
        ...공통입력,
        incomeType: 'WAGE_MONTHLY',
        basePay: input.basePay,
        ...(input.proration === undefined ? {} : { proration: { ...input.proration } }),
      }
    }
    case 'DAILY':
      return {
        incomeType: 'DAILY',
        attributionMonth,
        payAmount: input.payAmount,
        workDays: input.workDays,
        ...(input.averageDailyMinutes === undefined ? {} : { averageDailyMinutes: input.averageDailyMinutes }),
        insurance: {
          nationalPension: { mode: 'EXEMPT' },
          healthInsurance: { mode: 'EXEMPT' },
          employmentInsurance: { mode: input.employmentInsuranceExempt === true ? 'EXEMPT' : 'RATE' },
        },
        otherDeductions: (input.otherDeductions ?? []).map((line) => ({ ...line })),
      }
    case 'BUSINESS': {
      return {
        incomeType: 'BUSINESS',
        attributionMonth,
        payAmount: input.payAmount,
        taxDeductionMode: input.taxDeductionMode ?? 'BEFORE_TAX',
        // 고용보험 대상 여부는 업종코드가 아니라 계약으로 정해지므로 행의 표시만 봅니다(업종의 `detailType`은 화면 힌트).
        employmentInsurance: { applicable: input.employmentInsuranceApplicable === true },
        otherDeductions: (input.otherDeductions ?? []).map((line) => ({ ...line })),
      }
    }
    case 'OTHER': {
      const 소득구분코드 = findOtherIncomeCode(input.otherIncomeCode ?? DEFAULT_OTHER_INCOME_CODE, attributionMonth)
      return {
        incomeType: 'OTHER',
        attributionMonth,
        payAmount: input.payAmount,
        necessaryExpense:
          input.necessaryExpenseAmount !== undefined
            ? { kind: 'ACTUAL', amount: input.necessaryExpenseAmount }
            : { kind: 'DEEMED', ratePpm: 소득구분코드?.expenseRatePpm ?? 0 },
        ...(소득구분코드?.taxRatePpm == null ? {} : { taxRatePpm: 소득구분코드.taxRatePpm }),
        taxDeductionMode: input.taxDeductionMode ?? 'BEFORE_TAX',
        otherDeductions: (input.otherDeductions ?? []).map((line) => ({ ...line })),
      }
    }
  }
}

/**
 * 행을 계산합니다. 4대보험은 귀속월 기준표, 원천세는 지급월 기준표를 씁니다(현행 결정).
 * 두 달의 기준표가 다르면 지급월 기준표로 한 번 더 계산해 소득세·지방소득세만 바꿉니다.
 */
export function calculateRow(
  input: PayrollRowInputValue,
  snapshot: EmployeeSnapshot | null,
  context: RowCalculationContext,
): PayrollRowResultValue {
  const 엔진입력 = engineInputOf(input, snapshot, context)
  const 귀속월계산 = calculatePayrollRow(엔진입력, context.attributionRates)
  const 계산결과 =
    context.paymentRates.effectiveFrom === context.attributionRates.effectiveFrom
      ? 귀속월계산
      : 지급월세액반영(귀속월계산, calculatePayrollRow(엔진입력, context.paymentRates))
  return {
    rateTable: context.attributionRates.effectiveFrom,
    withholdingRateTable: context.paymentRates.effectiveFrom,
    payments: 계산결과.payments,
    grossPay: 계산결과.grossPay,
    taxablePay: 계산결과.taxablePay,
    nonTaxablePay: 계산결과.nonTaxablePay,
    employeeInsurance: 계산결과.insurance.employee,
    employerInsurance: 계산결과.insurance.employer,
    incomeTax: 계산결과.incomeTax,
    localIncomeTax: 계산결과.localIncomeTax,
    deductions: 계산결과.deductions,
    deductionTotal: 계산결과.deductionTotal,
    netPay: 계산결과.netPay,
    breakdown: 계산결과.breakdown,
    warnings: [...계산결과.warnings, ...행입력경고(input)],
  }
}

/**
 * 엔진이 아니라 행 입력(지급사유 코드)으로 정해지는 경고입니다.
 *
 * 서화·골동품(`64`)은 의제 경비 90%를 지급액 전체에 씁니다. 서식 주석은 1억원 초과분을 80%(보유 10년 이상이면 90%)로
 * 하므로, 1억원을 넘는데 실제 경비를 넣지 않으면 경비를 많이 잡아 세금을 덜 뗄 수 있습니다.
 */
function 행입력경고(input: PayrollRowInputValue): PayrollWarning[] {
  if (
    input.incomeType === 'OTHER' &&
    input.otherIncomeCode === ARTWORK_CODE &&
    input.necessaryExpenseAmount === undefined &&
    input.payAmount > ARTWORK_FULL_RATE_LIMIT
  ) {
    return [
      {
        code: 'ARTWORK_EXPENSE_RATE_SIMPLIFIED',
        message:
          '서화·골동품 양도가액이 1억원을 넘습니다. 초과분의 의제 경비는 80%(보유 10년 이상이면 90%)인데 90%로 계산했습니다. 실제 필요경비를 넣어 주세요.',
      },
    ]
  }
  return []
}

function 지급월세액반영(귀속월계산: PayrollRowResult, 지급월계산: PayrollRowResult): PayrollRowResult {
  const 금액교체 =
    (code: string, amount: number) =>
    <L extends { code: string; amount: number }>(line: L): L =>
      line.code === code ? { ...line, amount } : line
  const deductions = 귀속월계산.deductions
    .map(금액교체('INCOME_TAX', 지급월계산.incomeTax))
    .map(금액교체('LOCAL_INCOME_TAX', 지급월계산.localIncomeTax))
  const deductionTotal = deductions.reduce((total, line) => total + line.amount, 0)
  return {
    ...귀속월계산,
    incomeTax: 지급월계산.incomeTax,
    localIncomeTax: 지급월계산.localIncomeTax,
    deductions,
    deductionTotal,
    netPay: 귀속월계산.grossPay - deductionTotal,
    breakdown: 귀속월계산.breakdown
      .map(금액교체('INCOME_TAX', 지급월계산.incomeTax))
      .map(금액교체('LOCAL_INCOME_TAX', 지급월계산.localIncomeTax)),
  }
}

function 보험설정(가입대상인가: boolean, 산출방법: 'RATE' | 'NOTICE', 고지금액: number | undefined): InsuranceSetting {
  if (!가입대상인가) return { mode: 'EXEMPT' }
  if (산출방법 === 'RATE') return { mode: 'RATE' }
  return 고지금액 === undefined ? { mode: 'NOTICE' } : { mode: 'NOTICE', noticeAmount: 고지금액 }
}

function 소득세설정(직원정보사본: EmployeeSnapshot, 산출방법: 'TAX_TABLE' | 'MANUAL' | 'NONE'): WageIncomeTaxSetting {
  const 공통설정 = {
    dependants: 직원정보사본.dependants,
    childrenAged8To20: 직원정보사본.childrenAged8To20,
    withholdingRatePpm: 직원정보사본.withholdingRatePpm,
  }
  if (산출방법 === 'NONE') return { ...공통설정, method: 'NONE' }
  if (산출방법 === 'MANUAL' || 직원정보사본.manualIncomeTax !== null) {
    return { ...공통설정, method: 'MANUAL', manualAmount: 직원정보사본.manualIncomeTax ?? 0 }
  }
  return { ...공통설정, method: 'TAX_TABLE' }
}
