import { describe, expect, it } from 'vitest'
import { loadRuleCases } from '../payroll-fixture-loader.ts'
import type { NonTaxableCategory } from './rate-table.types.ts'
import type { PayrollRowInput, SeveranceInput, WageIncomeTaxSetting } from './engine.types.ts'
import { splitNonTaxable } from './non-taxable.ts'
import { calculatePayrollRow } from './payroll-row.ts'
import { RATES_2026_01 } from './rate-tables-2026.ts'
import { calculateSeverancePay } from './severance-pay.ts'
import { calculateSocialInsurance } from './social-insurance.ts'
import { calculateWageIncomeTax, EXACT_FORMULA, MIDPOINT_FORMULA, OFFICIAL_TABLE } from './wage-income-tax.ts'
import { MULTIPLIERS_FIVE_OR_MORE, MULTIPLIERS_UNDER_FIVE, prorate } from './working-time.ts'

const rates = RATES_2026_01
const ALL_RATE = {
  nationalPension: { mode: 'RATE' },
  healthInsurance: { mode: 'RATE' },
  employmentInsurance: { mode: 'RATE' },
} as const
const EI_ONLY = {
  nationalPension: { mode: 'EXEMPT' },
  healthInsurance: { mode: 'EXEMPT' },
  employmentInsurance: { mode: 'RATE' },
} as const
const ONE_DEPENDANT: WageIncomeTaxSetting = {
  method: 'TAX_TABLE',
  dependants: 1,
  childrenAged8To20: 0,
  withholdingRatePpm: 1_000_000,
}

describe('규칙 픽스처: social-insurance-premiums', () => {
  it.each(loadRuleCases<{ insurablePay: number }, Record<string, number>>('social-insurance-premiums'))(
    '$name',
    ({ input, expected }) => {
      const { employee } = calculateSocialInsurance({ ...ALL_RATE, insurablePay: input.insurablePay }, rates)
      expect(employee).toMatchObject(expected)
    },
  )
})

const SIMPLE_TAX_STRATEGIES = { OFFICIAL_TABLE, EXACT_FORMULA, MIDPOINT_FORMULA }

describe('규칙 픽스처: simple-income-tax', () => {
  type Input = {
    monthlyTaxablePay: number
    dependants: number
    childrenAged8To20: number
    withholdingRatePpm: number
    strategy: keyof typeof SIMPLE_TAX_STRATEGIES
  }
  it.each(loadRuleCases<Input, { incomeTax: number; localIncomeTax: number }>('simple-income-tax'))(
    '$name',
    ({ input, expected }) => {
      const result = calculateWageIncomeTax(
        input.monthlyTaxablePay,
        {
          method: 'TAX_TABLE',
          dependants: input.dependants,
          childrenAged8To20: input.childrenAged8To20,
          withholdingRatePpm: input.withholdingRatePpm,
        },
        rates,
        SIMPLE_TAX_STRATEGIES[input.strategy],
      )
      expect({ incomeTax: result.incomeTax, localIncomeTax: result.localIncomeTax }).toEqual(expected)
    },
  )
})

describe('규칙 픽스처: daily-worker-withholding', () => {
  it.each(loadRuleCases<{ payAmount: number; workDays: number }, Record<string, number>>('daily-worker-withholding'))(
    '$name',
    ({ input, expected }) => {
      const row = calculatePayrollRow(
        { incomeType: 'DAILY', attributionMonth: '2026-03', ...input, insurance: EI_ONLY },
        rates,
      )
      expect({
        employmentInsurance: row.insurance.employee.employmentInsurance,
        incomeTax: row.incomeTax,
        localIncomeTax: row.localIncomeTax,
        netPay: row.netPay,
      }).toMatchObject(expected)
    },
  )
})

describe('규칙 픽스처: business-income-withholding', () => {
  type Input = { payAmount: number; taxDeductionMode?: 'BEFORE_TAX' | 'AFTER_TAX'; artistEmploymentInsurance?: boolean }
  it.each(loadRuleCases<Input, Record<string, number>>('business-income-withholding'))(
    '$name',
    ({ input, expected }) => {
      const row = calculatePayrollRow(
        {
          incomeType: 'BUSINESS',
          attributionMonth: '2026-03',
          payAmount: input.payAmount,
          ...(input.taxDeductionMode === undefined ? {} : { taxDeductionMode: input.taxDeductionMode }),
          ...(input.artistEmploymentInsurance === true ? { employmentInsurance: { applicable: true } } : {}),
        },
        rates,
      )
      expect({
        grossPay: row.grossPay,
        incomeTax: row.incomeTax,
        localIncomeTax: row.localIncomeTax,
        employmentInsurance: row.insurance.employee.employmentInsurance,
        netPay: row.netPay,
      }).toMatchObject(expected)
    },
  )
})

describe('규칙 픽스처: other-income-withholding', () => {
  it.each(
    loadRuleCases<{ payAmount: number; expenseRatePpm: number }, Record<string, number>>('other-income-withholding'),
  )('$name', ({ input, expected }) => {
    const row = calculatePayrollRow(
      {
        incomeType: 'OTHER',
        attributionMonth: '2026-03',
        payAmount: input.payAmount,
        necessaryExpense: { kind: 'DEEMED', ratePpm: input.expenseRatePpm },
      },
      rates,
    )
    expect({ incomeTax: row.incomeTax, localIncomeTax: row.localIncomeTax, netPay: row.netPay }).toEqual(expected)
  })
})

describe('규칙 픽스처: non-taxable-limits', () => {
  type Input = { category: NonTaxableCategory; amount: number; companyNonTaxableLimit?: number }
  it.each(loadRuleCases<Input, { nonTaxableAmount: number; taxableAmount: number }>('non-taxable-limits'))(
    '$name',
    ({ input, expected }) => {
      const [line] = splitNonTaxable(
        [
          {
            code: input.category,
            name: input.category,
            amount: input.amount,
            nonTaxableCategory: input.category,
            ...(input.companyNonTaxableLimit === undefined
              ? {}
              : { companyNonTaxableLimit: input.companyNonTaxableLimit }),
          },
        ],
        rates,
      ).lines
      expect(line).toMatchObject(expected)
    },
  )
})

describe('규칙 픽스처: overtime-multipliers', () => {
  type Input = Record<string, unknown> & { multipliers: 'FIVE_OR_MORE' | 'UNDER_FIVE' }
  it.each(
    loadRuleCases<Input, { payments: Record<string, number>; grossPay: number; employmentInsurance?: number }>(
      'overtime-multipliers',
    ),
  )('$name', ({ input, expected }) => {
    const row = calculatePayrollRow(
      {
        attributionMonth: '2026-03',
        paymentItems: [],
        insurance: input.incomeType === 'WAGE_HOURLY' ? EI_ONLY : ALL_RATE,
        incomeTax: ONE_DEPENDANT,
        ...input,
        multipliers: input.multipliers === 'UNDER_FIVE' ? MULTIPLIERS_UNDER_FIVE : MULTIPLIERS_FIVE_OR_MORE,
      } as unknown as PayrollRowInput,
      rates,
    )
    expect(Object.fromEntries(row.payments.map((line) => [line.code, line.amount]))).toEqual(expected.payments)
    expect(row.grossPay).toBe(expected.grossPay)
    if (expected.employmentInsurance !== undefined) {
      expect(row.insurance.employee.employmentInsurance).toBe(expected.employmentInsurance)
    }
  })
})

describe('규칙 픽스처: wage-proration', () => {
  type Input = { amount: number; payableDays: number; totalDays: number }
  it.each(loadRuleCases<Input, { amount: number }>('wage-proration'))('$name', ({ input, expected }) => {
    expect(
      prorate(input.amount, { method: 'CALENDAR_DAYS', payableDays: input.payableDays, totalDays: input.totalDays }),
    ).toBe(expected.amount)
  })
})

describe('규칙 픽스처: minimum-wage-warning', () => {
  it.each(loadRuleCases<{ basePay: number }, { warnings: string[] }>('minimum-wage-warning'))(
    '$name',
    ({ input, expected }) => {
      const row = calculatePayrollRow(
        {
          incomeType: 'WAGE_MONTHLY',
          attributionMonth: '2026-03',
          basePay: input.basePay,
          paymentItems: [],
          multipliers: MULTIPLIERS_FIVE_OR_MORE,
          monthlyStandardHours: 209,
          insurance: ALL_RATE,
          incomeTax: ONE_DEPENDANT,
        },
        rates,
      )
      expect(row.warnings.map((warning) => warning.code)).toEqual(expected.warnings)
    },
  )
})

describe('규칙 픽스처: severance-pay', () => {
  it.each(loadRuleCases<SeveranceInput, Record<string, unknown>>('severance-pay'))('$name', ({ input, expected }) => {
    expect(calculateSeverancePay(input, rates)).toMatchObject(expected)
  })
})
