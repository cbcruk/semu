import type { DatabaseSync } from 'node:sqlite'
import { sum } from '../engine/engine.utils'
import type {
  DeductionLine,
  InsuranceSetting,
  OtherDeductionInput,
  PaymentItemInput,
  PayrollRowInput,
  PayrollRowResult,
  PremiumMultipliers,
} from '../engine/engine.types'
import { calculatePayrollRow } from '../engine/payroll-row'
import type { PayrollRateTable, YearMonth } from '../engine/rate-table.types'
import { findOtherIncomeType } from '../reference/reference-data'
import { rateTableFor } from '../reference/rate-tables.repository'
import * as settings from '../settings/settings.repository'
import type { DeductionItemRow, DeductionSettingsRow, InsuranceMethod, PaymentItemRow, PayrollTermsRow } from '../settings/settings.types'
import { fromX100 } from '../settings/settings.utils'
import { listCardItemFlags } from './cards.repository'
import type {
  BusinessInputData,
  CardRow,
  DailyInputData,
  EmployeeSnapshot,
  ItemAmount,
  OtherInputData,
  PayrollRowRecord,
  RowOverrides,
  WageInputData,
} from './cards.types'
import { isWageIncome, parseJsonColumn, paymentMonthOf } from './cards.utils'

/** Other income type used when a row names none: 그 밖에 필요경비 있는 기타소득 (60%). */
export const DEFAULT_OTHER_INCOME_TYPE = '60'

/** Snapshot used when a wage row has no HR data: one dependant, every insurance, 209 hours. */
export const DEFAULT_SNAPSHOT: EmployeeSnapshot = {
  dependants: 1,
  children_8_to_20: 0,
  withholding_ratio: 100,
  income_tax_method: 'tax_table_based',
  manual_income_tax: null,
  insurance_enrolled: { national_pension: true, health_insurance: true, employment_insurance: true },
  monthly_standard_hours: 209,
  daily_rest_hours: 8,
}

/** Company settings and rate tables one card's rows are calculated with. */
export interface CalculationContext {
  attributionMonth: YearMonth
  /** Table of the attribution month, used for social insurance. */
  attributionRates: PayrollRateTable
  /** Table of the payment month, used for withholding taxes. */
  paymentRates: PayrollRateTable
  terms: PayrollTermsRow
  deduction: DeductionSettingsRow
  paymentItems: Map<number, PaymentItemRow>
  deductionItems: Map<number, DeductionItemRow>
  enabledPayments: Map<number, boolean>
  enabledDeductions: Map<number, boolean>
}

/**
 * Loads everything needed to calculate a card's rows.
 *
 * Expects {@linkcode ensurePayrollSettings} to have run for the company.
 *
 * @throws {Error} When the company has no payroll settings.
 */
export function loadCalculationContext(db: DatabaseSync, card: CardRow): CalculationContext {
  const terms = settings.findTerms(db, card.company_id)
  const deduction = settings.findDeductionSettings(db, card.company_id)
  if (terms === undefined || deduction === undefined) throw new Error(`Payroll settings of ${card.company_id} are missing.`)
  const deductionItems = settings.listDeductionItems(db, card.company_id, 1_000, 0).rows
  return {
    attributionMonth: card.attribution_month,
    attributionRates: rateTableFor(db, card.attribution_month),
    paymentRates: rateTableFor(db, paymentMonthOf(card.payment_date)),
    terms,
    deduction,
    paymentItems: new Map(settings.listAllPaymentItems(db, card.company_id).map((item) => [item.id, item])),
    deductionItems: new Map(deductionItems.map((item) => [item.id, item])),
    enabledPayments: listCardItemFlags(db, card.id, 'payment'),
    enabledDeductions: listCardItemFlags(db, card.id, 'deduction'),
  }
}

/**
 * Calculates a stored row with the engine.
 *
 * Social insurance uses the attribution month's table and withholding taxes
 * the payment month's table (spec 4.13). When the two months resolve to
 * different tables the row is calculated twice and the taxes of the second
 * run replace those of the first. Manual overrides are applied last.
 */
export function calculateStoredRow(row: PayrollRowRecord, context: CalculationContext): PayrollRowResult {
  const input = engineInputOf(row, context)
  const insuranceRun = calculatePayrollRow(input, context.attributionRates)
  const result =
    context.paymentRates.effectiveFrom === context.attributionRates.effectiveFrom
      ? insuranceRun
      : withAmounts(insuranceRun, taxAmountsOf(calculatePayrollRow(input, context.paymentRates)), '지급월 기준표')
  return applyOverrides(result, parseJsonColumn<RowOverrides>(row.overrides, {}))
}

/** Builds the engine input of a stored row. */
export function engineInputOf(row: PayrollRowRecord, context: CalculationContext): PayrollRowInput {
  const month = context.attributionMonth
  if (isWageIncome(row.income_type)) {
    const data = parseJsonColumn<WageInputData>(row.input, {} as WageInputData)
    const snapshot = { ...DEFAULT_SNAPSHOT, ...parseJsonColumn<Partial<EmployeeSnapshot>>(row.snapshot, {}) }
    const base = {
      attributionMonth: month,
      paymentItems: paymentItemsOf(data.payment_items, context),
      work: {
        regularHours: data.work.regular_hours,
        overtimeHours: data.work.overtime_hours,
        nightHours: data.work.night_hours,
        holidayHours: data.work.holiday_hours,
        holidayOvertimeHours: data.work.holiday_overtime_hours,
        absenceHours: data.work.absence_hours,
        weeklyHolidayDeductionDays: data.work.weekly_holiday_deduction_days,
      },
      multipliers: multipliersOf(context.terms),
      monthlyStandardHours: snapshot.monthly_standard_hours,
      dailyRestHours: snapshot.daily_rest_hours,
      insurance: {
        nationalPension: insuranceSetting(snapshot.insurance_enrolled.national_pension, context.deduction.national_pension_method, data.insurance_notice.national_pension),
        healthInsurance: {
          ...insuranceSetting(snapshot.insurance_enrolled.health_insurance, context.deduction.health_insurance_method, data.insurance_notice.health_insurance),
          ...(data.insurance_notice.long_term_care === undefined ? {} : { longTermCareNoticeAmount: data.insurance_notice.long_term_care }),
        },
        employmentInsurance: insuranceSetting(
          snapshot.insurance_enrolled.employment_insurance,
          context.deduction.employment_insurance_method,
          data.insurance_notice.employment_insurance,
        ),
      },
      incomeTax: {
        method:
          context.deduction.income_tax_method === 'none'
            ? ('none' as const)
            : context.deduction.income_tax_method === 'manual_input' || snapshot.income_tax_method === 'manual_input'
              ? ('manual_input' as const)
              : ('tax_table_based' as const),
        dependants: snapshot.dependants,
        childrenAged8To20: snapshot.children_8_to_20,
        withholdingRatio: snapshot.withholding_ratio,
        manualAmount: snapshot.manual_income_tax ?? 0,
      },
      otherDeductions: deductionsOf(data.deduction_items, context),
    }
    if (row.income_type === 'wage_hourly') {
      return { ...base, incomeType: 'wage_hourly', hourlyWage: data.hourly_wage, weeklyHolidayWeeks: data.work.weekly_holiday_weeks }
    }
    if (row.income_type === 'wage_daily') {
      return { ...base, incomeType: 'wage_daily', dailyWage: data.daily_wage, workedDays: data.worked_days, weeklyHolidayWeeks: data.work.weekly_holiday_weeks }
    }
    return {
      ...base,
      incomeType: 'wage_monthly',
      basePay: data.base_pay,
      ...(data.proration === null ? {} : { proration: { method: 'calendar_days', payableDays: data.proration.payable_days, totalDays: data.proration.total_days } }),
    }
  }
  if (row.income_type === 'daily') {
    const data = parseJsonColumn<DailyInputData>(row.input, {} as DailyInputData)
    return {
      incomeType: 'daily',
      attributionMonth: month,
      payAmount: data.pay_amount,
      workDays: Math.max(1, data.work_dates.length > 0 ? data.work_dates.length : (data.work_days ?? 1)),
      ...(data.avg_daily_hours === null ? {} : { averageDailyHours: data.avg_daily_hours }),
      insurance: {
        nationalPension: { mode: 'exempt' },
        healthInsurance: { mode: 'exempt' },
        employmentInsurance: { mode: data.is_owner_or_cohabiting_relative ? 'exempt' : 'rate' },
      },
      otherDeductions: deductionsOf(data.deduction_items, context),
    }
  }
  if (row.income_type === 'business') {
    const data = parseJsonColumn<BusinessInputData>(row.input, {} as BusinessInputData)
    return {
      incomeType: 'business',
      attributionMonth: month,
      payAmount: data.pay_amount,
      taxDeductionMode: data.tax_deduction_mode,
      employmentInsurance: { applicable: data.detail_type !== null && data.employment_insurance_applicable },
    }
  }
  const data = parseJsonColumn<OtherInputData>(row.input, {} as OtherInputData)
  const type = findOtherIncomeType(data.other_income_type_code ?? DEFAULT_OTHER_INCOME_TYPE, month)
  return {
    incomeType: 'other',
    attributionMonth: month,
    payAmount: data.pay_amount,
    necessaryExpense:
      data.necessary_expense_amount !== null ? { kind: 'actual', amount: data.necessary_expense_amount } : { kind: 'deemed', ratePpm: type?.expenseRatePpm ?? 0 },
    ...(type === undefined ? {} : { taxRatePpm: type.taxRatePpm }),
    taxDeductionMode: data.tax_deduction_mode,
  }
}

/** Converts the payroll terms' `*_x100` multipliers into engine multipliers. */
export function multipliersOf(terms: PayrollTermsRow): PremiumMultipliers {
  return {
    overtime: fromX100(terms.fixed_overtime_multiplier_x100),
    night: fromX100(terms.fixed_night_multiplier_x100),
    holiday: fromX100(terms.fixed_holiday_multiplier_x100),
    holidayOvertime: fromX100(terms.fixed_holiday_overtime_multiplier_x100),
  }
}

/**
 * Applies manual amounts over a calculation (`PUT payroll-input/:r` with `overrides`).
 *
 * Overridden deductions keep their line with the formula `수동 입력`; totals
 * and the employee insurance premiums are recomputed.
 */
export function applyOverrides(result: PayrollRowResult, overrides: RowOverrides): PayrollRowResult {
  const amounts: Record<string, number> = {}
  for (const [key, value] of Object.entries(overrides)) if (typeof value === 'number') amounts[key] = value
  return Object.keys(amounts).length === 0 ? result : withAmounts(result, amounts, '수동 입력')
}

const DEDUCTION_NAMES: Record<string, string> = {
  national_pension: '국민연금',
  health_insurance: '건강보험',
  long_term_care: '장기요양보험',
  employment_insurance: '고용보험',
  income_tax: '소득세',
  local_income_tax: '지방소득세',
}

function withAmounts(result: PayrollRowResult, amounts: Record<string, number>, formula: string): PayrollRowResult {
  const deductions: DeductionLine[] = result.deductions.map((line) =>
    amounts[line.code] === undefined ? line : { ...line, amount: amounts[line.code] ?? line.amount, formula },
  )
  for (const [code, amount] of Object.entries(amounts)) {
    if (!deductions.some((line) => line.code === code)) deductions.push({ code, name: DEDUCTION_NAMES[code] ?? code, amount, formula })
  }
  const lineOf = (code: string): number => deductions.find((line) => line.code === code)?.amount ?? 0
  const employee = {
    ...result.insurance.employee,
    nationalPension: lineOf('national_pension'),
    healthInsurance: lineOf('health_insurance'),
    longTermCare: lineOf('long_term_care'),
    employmentInsurance: lineOf('employment_insurance'),
  }
  employee.total = employee.nationalPension + employee.healthInsurance + employee.longTermCare + employee.employmentInsurance + employee.industrialAccident
  const deductionTotal = sum(deductions.map((line) => line.amount))
  const replaced = new Map(deductions.map((line) => [line.code, line]))
  return {
    ...result,
    insurance: { ...result.insurance, employee },
    incomeTax: lineOf('income_tax'),
    localIncomeTax: lineOf('local_income_tax'),
    deductions,
    deductionTotal,
    netPay: result.grossPay - deductionTotal,
    breakdown: result.breakdown.map((entry) => {
      const line = amounts[entry.code] === undefined ? undefined : replaced.get(entry.code)
      return line === undefined ? entry : { ...entry, amount: line.amount, formula: line.formula }
    }),
  }
}

function taxAmountsOf(result: PayrollRowResult): Record<string, number> {
  return { income_tax: result.incomeTax, local_income_tax: result.localIncomeTax }
}

function insuranceSetting(enrolled: boolean, method: InsuranceMethod, noticeAmount: number | undefined): InsuranceSetting {
  if (!enrolled) return { mode: 'exempt' }
  if (method === 'rate') return { mode: 'rate' }
  return noticeAmount === undefined ? { mode: 'notice' } : { mode: 'notice', noticeAmount }
}

function paymentItemsOf(items: readonly ItemAmount[], context: CalculationContext): PaymentItemInput[] {
  return items.flatMap((entry) => {
    const item = context.paymentItems.get(entry.item_id)
    if (item === undefined || item.is_system === 1 || context.enabledPayments.get(item.id) === false || entry.amount === 0) return []
    const input: PaymentItemInput = {
      code: `payment_item_${item.id}`,
      name: item.name,
      amount: entry.amount,
      includeInOrdinaryWage: item.include_in_ordinary_wage === 1,
      includeInMinimumWage: item.include_in_minimum_wage === 1,
      prorate: item.include_in_monthly_salary === 1,
    }
    if (item.is_taxable === 0 && item.non_taxable_category !== null) {
      input.nonTaxableCategory = item.non_taxable_category
      if (item.non_taxable_limit_enabled === 1 && item.non_taxable_limit_amount !== null) input.companyNonTaxableLimit = item.non_taxable_limit_amount
    }
    return [input]
  })
}

function deductionsOf(items: readonly ItemAmount[], context: CalculationContext): OtherDeductionInput[] {
  return items.flatMap((entry) => {
    const item = context.deductionItems.get(entry.item_id)
    if (item === undefined || context.enabledDeductions.get(item.id) === false || entry.amount === 0) return []
    return [{ code: `deduction_item_${item.id}`, name: item.name, amount: entry.amount }]
  })
}
