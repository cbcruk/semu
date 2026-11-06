import type {
  InsuranceSetting,
  PayrollRowInput,
  PayrollRowResult,
  PremiumMultipliers,
  WageIncomeTaxSetting,
} from '../engine/engine.types.ts'
import { calculatePayrollRow } from '../engine/payroll-row.ts'
import type { PayrollRateTable } from '../engine/rate-table.types.ts'
import {
  BUSINESS_INCOME_CODES,
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
      const employee = snapshot ?? DEFAULT_EMPLOYEE_SNAPSHOT
      const methods = context.setting.deductionMethods
      const notice = input.insuranceNotice ?? {}
      const base = {
        attributionMonth,
        paymentItems: (input.paymentItems ?? []).map((item) => ({ ...item })),
        work: { ...input.work },
        multipliers: { ...context.setting.multipliers } satisfies PremiumMultipliers,
        monthlyStandardHours: employee.monthlyStandardHours,
        dailyRestMinutes: employee.dailyRestMinutes,
        insurance: {
          nationalPension: insuranceSetting(
            employee.socialInsurance.nationalPension,
            methods.nationalPension,
            notice.nationalPension,
          ),
          healthInsurance: {
            ...insuranceSetting(
              employee.socialInsurance.healthInsurance,
              methods.healthInsurance,
              notice.healthInsurance,
            ),
            ...(notice.longTermCare === undefined ? {} : { longTermCareNoticeAmount: notice.longTermCare }),
          },
          employmentInsurance: insuranceSetting(
            employee.socialInsurance.employmentInsurance,
            methods.employmentInsurance,
            notice.employmentInsurance,
          ),
        },
        incomeTax: incomeTaxSetting(employee, methods.incomeTax),
        ...(employee.childcareChildren === undefined ? {} : { childcareChildren: employee.childcareChildren }),
        ...(employee.childcareChildrenEffectiveFrom === undefined
          ? {}
          : { childcareChildrenEffectiveFrom: employee.childcareChildrenEffectiveFrom }),
        otherDeductions: (input.otherDeductions ?? []).map((line) => ({ ...line })),
      }
      if (input.incomeType === 'WAGE_HOURLY') {
        return {
          ...base,
          incomeType: 'WAGE_HOURLY',
          hourlyWage: input.hourlyWage,
          ...(input.weeklyHolidayWeeks === undefined ? {} : { weeklyHolidayWeeks: input.weeklyHolidayWeeks }),
        }
      }
      if (input.incomeType === 'WAGE_DAILY') {
        return {
          ...base,
          incomeType: 'WAGE_DAILY',
          dailyWage: input.dailyWage,
          workedDays: input.workedDays,
          ...(input.weeklyHolidayWeeks === undefined ? {} : { weeklyHolidayWeeks: input.weeklyHolidayWeeks }),
        }
      }
      return {
        ...base,
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
      const detailType =
        BUSINESS_INCOME_CODES.find((code) => code.code === input.businessIncomeCode)?.detailType ?? null
      return {
        incomeType: 'BUSINESS',
        attributionMonth,
        payAmount: input.payAmount,
        taxDeductionMode: input.taxDeductionMode ?? 'BEFORE_TAX',
        employmentInsurance: { applicable: detailType !== null && input.employmentInsuranceApplicable === true },
        otherDeductions: (input.otherDeductions ?? []).map((line) => ({ ...line })),
      }
    }
    case 'OTHER': {
      const type = findOtherIncomeCode(input.otherIncomeCode ?? DEFAULT_OTHER_INCOME_CODE, attributionMonth)
      return {
        incomeType: 'OTHER',
        attributionMonth,
        payAmount: input.payAmount,
        necessaryExpense:
          input.necessaryExpenseAmount !== undefined
            ? { kind: 'ACTUAL', amount: input.necessaryExpenseAmount }
            : { kind: 'DEEMED', ratePpm: type?.expenseRatePpm ?? 0 },
        ...(type?.taxRatePpm == null ? {} : { taxRatePpm: type.taxRatePpm }),
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
  const engineInput = engineInputOf(input, snapshot, context)
  const insuranceRun = calculatePayrollRow(engineInput, context.attributionRates)
  const result =
    context.paymentRates.effectiveFrom === context.attributionRates.effectiveFrom
      ? insuranceRun
      : withTaxesOf(insuranceRun, calculatePayrollRow(engineInput, context.paymentRates))
  return {
    rateTable: context.attributionRates.effectiveFrom,
    withholdingRateTable: context.paymentRates.effectiveFrom,
    payments: result.payments,
    grossPay: result.grossPay,
    taxablePay: result.taxablePay,
    nonTaxablePay: result.nonTaxablePay,
    employeeInsurance: result.insurance.employee,
    employerInsurance: result.insurance.employer,
    incomeTax: result.incomeTax,
    localIncomeTax: result.localIncomeTax,
    deductions: result.deductions,
    deductionTotal: result.deductionTotal,
    netPay: result.netPay,
    breakdown: result.breakdown,
    warnings: result.warnings,
  }
}

function withTaxesOf(result: PayrollRowResult, taxRun: PayrollRowResult): PayrollRowResult {
  const replace =
    (code: string, amount: number) =>
    <L extends { code: string; amount: number }>(line: L): L =>
      line.code === code ? { ...line, amount } : line
  const deductions = result.deductions
    .map(replace('INCOME_TAX', taxRun.incomeTax))
    .map(replace('LOCAL_INCOME_TAX', taxRun.localIncomeTax))
  const deductionTotal = deductions.reduce((total, line) => total + line.amount, 0)
  return {
    ...result,
    incomeTax: taxRun.incomeTax,
    localIncomeTax: taxRun.localIncomeTax,
    deductions,
    deductionTotal,
    netPay: result.grossPay - deductionTotal,
    breakdown: result.breakdown
      .map(replace('INCOME_TAX', taxRun.incomeTax))
      .map(replace('LOCAL_INCOME_TAX', taxRun.localIncomeTax)),
  }
}

function insuranceSetting(enrolled: boolean, method: 'RATE' | 'NOTICE', notice: number | undefined): InsuranceSetting {
  if (!enrolled) return { mode: 'EXEMPT' }
  if (method === 'RATE') return { mode: 'RATE' }
  return notice === undefined ? { mode: 'NOTICE' } : { mode: 'NOTICE', noticeAmount: notice }
}

function incomeTaxSetting(employee: EmployeeSnapshot, method: 'TAX_TABLE' | 'MANUAL' | 'NONE'): WageIncomeTaxSetting {
  const base = {
    dependants: employee.dependants,
    childrenAged8To20: employee.childrenAged8To20,
    withholdingRatePpm: employee.withholdingRatePpm,
  }
  if (method === 'NONE') return { ...base, method: 'NONE' }
  if (method === 'MANUAL' || employee.manualIncomeTax !== null) {
    return { ...base, method: 'MANUAL', manualAmount: employee.manualIncomeTax ?? 0 }
  }
  return { ...base, method: 'TAX_TABLE' }
}
