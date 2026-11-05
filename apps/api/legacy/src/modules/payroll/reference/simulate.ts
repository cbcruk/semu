import type { z } from 'zod'
import { invalidField } from '../../../lib/domain-error'
import type { PaymentItemInput, PayrollRowInput, PayrollRowResult } from '../engine/engine.types'
import { calculatePayrollRow } from '../engine/payroll-row'
import type { PayrollRateTable, YearMonth } from '../engine/rate-table.types'
import { MULTIPLIERS_FIVE_OR_MORE } from '../engine/working-time'
import { findOtherIncomeType } from './reference-data'
import type { simulateBody } from './simulate.schema'

type SimulateBody = z.infer<typeof simulateBody>

const RATE_INSURANCE = {
  nationalPension: { mode: 'rate' },
  healthInsurance: { mode: 'rate' },
  employmentInsurance: { mode: 'rate' },
} as const

const DEFAULT_OTHER_INCOME_TYPE = '60'

/**
 * Builds the engine input of a salary calculator tab.
 *
 * - `wage`: a monthly salary with every insurance by rate. `non_taxable_pay` is
 *   trusted as already non-taxable; `meal_allowance` is capped at the meal limit.
 * - `daily`: `daily_pay × work_days`, employment insurance only.
 * - `business`: 3.3% withholding, optionally grossed up from the net amount.
 * - `other`: the expense rate of `income_type_code` (default `60`, 60%) unless
 *   `necessary_expense_rate` overrides it.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for an unknown other-income type.
 */
export function simulationInput(body: SimulateBody, month: YearMonth): PayrollRowInput {
  switch (body.type) {
    case 'wage': {
      const items: PaymentItemInput[] = []
      if ((body.meal_allowance ?? 0) > 0) items.push({ code: 'meal', name: '식대', amount: body.meal_allowance ?? 0, nonTaxableCategory: 'meal' })
      if ((body.non_taxable_pay ?? 0) > 0) items.push({ code: 'non_taxable', name: '비과세', amount: body.non_taxable_pay ?? 0, preclassifiedNonTaxable: true })
      return {
        incomeType: 'wage_monthly',
        attributionMonth: month,
        basePay: body.monthly_pay,
        paymentItems: items,
        multipliers: MULTIPLIERS_FIVE_OR_MORE,
        monthlyStandardHours: 209,
        insurance: RATE_INSURANCE,
        incomeTax: {
          method: 'tax_table_based',
          dependants: body.dependants ?? 1,
          childrenAged8To20: body.children_aged_8_to_20 ?? 0,
          withholdingRatio: body.withholding_ratio ?? 100,
        },
      }
    }
    case 'daily': {
      const days = body.work_days ?? 1
      return {
        incomeType: 'daily',
        attributionMonth: month,
        payAmount: body.daily_pay * days,
        workDays: days,
        insurance: { nationalPension: { mode: 'exempt' }, healthInsurance: { mode: 'exempt' }, employmentInsurance: { mode: 'rate' } },
      }
    }
    case 'business':
      return { incomeType: 'business', attributionMonth: month, payAmount: body.pay_amount, taxDeductionMode: body.tax_deduction_mode ?? 'before_tax' }
    case 'other': {
      const type = findOtherIncomeType(body.income_type_code ?? DEFAULT_OTHER_INCOME_TYPE, month)
      if (type === undefined) throw invalidField('income_type_code', 'Unknown other income type.')
      const expenseRatePpm = body.necessary_expense_rate === undefined ? (type.expenseRatePpm ?? 0) : body.necessary_expense_rate * 10_000
      return {
        incomeType: 'other',
        attributionMonth: month,
        payAmount: body.pay_amount,
        necessaryExpense: { kind: 'deemed', ratePpm: expenseRatePpm },
        taxRatePpm: type.taxRatePpm,
        taxDeductionMode: body.tax_deduction_mode ?? 'before_tax',
      }
    }
  }
}

/** Runs a salary calculator simulation and serializes it with snake_case keys, as the client reads it untransformed. */
export function simulate(body: SimulateBody, month: YearMonth, rates: PayrollRateTable): Record<string, unknown> {
  return serializeRowResult(body.type, calculatePayrollRow(simulationInput(body, month), rates))
}

/** Serializes an engine result with snake_case keys. */
export function serializeRowResult(type: string, result: PayrollRowResult): Record<string, unknown> {
  const employee = result.insurance.employee
  const employer = result.insurance.employer
  return {
    type,
    income_type: result.incomeType,
    attribution_month: result.attributionMonth,
    rate_table: result.rateTable,
    gross_pay: result.grossPay,
    taxable_pay: result.taxablePay,
    non_taxable_pay: result.nonTaxablePay,
    national_pension: employee.nationalPension,
    health_insurance: employee.healthInsurance,
    long_term_care_insurance: employee.longTermCare,
    employment_insurance: employee.employmentInsurance,
    income_tax: result.incomeTax,
    local_income_tax: result.localIncomeTax,
    deduction_total: result.deductionTotal,
    net_pay: result.netPay,
    employer: {
      national_pension: employer.nationalPension,
      health_insurance: employer.healthInsurance,
      long_term_care_insurance: employer.longTermCare,
      employment_insurance: employer.employmentInsurance,
      industrial_accident_insurance: employer.industrialAccident,
      total: employer.total,
    },
    payments: result.payments.map((line) => ({
      code: line.code,
      name: line.name,
      amount: line.amount,
      taxable_amount: line.taxableAmount,
      non_taxable_amount: line.nonTaxableAmount,
      formula: line.formula,
    })),
    deductions: result.deductions.map((line) => ({ code: line.code, name: line.name, amount: line.amount, formula: line.formula })),
    breakdown: result.breakdown,
    warnings: result.warnings,
  }
}
