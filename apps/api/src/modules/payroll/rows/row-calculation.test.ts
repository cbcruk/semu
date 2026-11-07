import { describe, expect, it } from 'vitest'
import { calculatePayrollRow } from '../engine/payroll-row.ts'
import { resolveRateTable } from '../engine/rate-table.ts'
import { BUILT_IN_RATE_TABLES, RATES_2026_01, RATES_2026_03 } from '../engine/rate-tables-2026.ts'
import { defaultPayrollSetting } from '../settings/payroll-setting.ts'
import type { PayrollRowInputValue } from './payroll-row-input.ts'
import {
  calculateRow,
  DEFAULT_EMPLOYEE_SNAPSHOT,
  engineInputOf,
  type RowCalculationContext,
} from './row-calculation.ts'

const input: PayrollRowInputValue = { incomeType: 'WAGE_MONTHLY', basePay: 3_000_000 }
const snapshot = { ...DEFAULT_EMPLOYEE_SNAPSHOT, dependants: 2, childrenAged8To20: 1 }
const setting = {
  ...defaultPayrollSetting(),
  deductionMethods: {
    nationalPension: 'RATE',
    healthInsurance: 'RATE',
    employmentInsurance: 'RATE',
    incomeTax: 'TAX_TABLE',
  },
} as const

function context(attributionMonth: string, paymentMonth: string): RowCalculationContext {
  return {
    attributionMonth,
    attributionRates: resolveRateTable(BUILT_IN_RATE_TABLES, attributionMonth),
    paymentRates: resolveRateTable(BUILT_IN_RATE_TABLES, paymentMonth),
    setting,
  }
}

describe('calculateRow across rate table boundaries', () => {
  it('withholds a February row paid in March with the March child credit', () => {
    const boundary = context('2026-02', '2026-03')
    const result = calculateRow(input, snapshot, boundary)
    const engineInput = engineInputOf(input, snapshot, boundary)
    const february = calculatePayrollRow(engineInput, RATES_2026_01)
    const march = calculatePayrollRow(engineInput, RATES_2026_03)

    expect(result.rateTable).toBe('2026-01')
    expect(result.withholdingRateTable).toBe('2026-03')
    expect(RATES_2026_03.wageIncomeTax.childCreditMonthly.one).toBe(20_830)
    // 자녀 1명 공제가 12,500원에서 20,830원으로 늘어 8,330원 줄어듭니다.
    expect(february.incomeTax - march.incomeTax).toBe(20_830 - 12_500)
    expect(result.incomeTax).toBe(march.incomeTax)
    expect(result.localIncomeTax).toBe(march.localIncomeTax)
    expect(result.employeeInsurance).toEqual(february.insurance.employee)
  })

  it('takes insurance from the attribution month and tax from the payment month around November 2026', () => {
    const october = calculateRow(input, snapshot, context('2026-10', '2026-11'))
    const november = calculateRow(input, snapshot, context('2026-11', '2026-11'))

    expect([october.rateTable, october.withholdingRateTable]).toEqual(['2026-07', '2026-11'])
    expect([november.rateTable, november.withholdingRateTable]).toEqual(['2026-11', '2026-11'])
    // 3,000,000 × 3.595% = 107,850; × 13.14% = 14,171.49 → 14,170 (두 기준표 모두 131,400ppm)
    expect(october.employeeInsurance.longTermCare).toBe(14_170)
    expect(november.employeeInsurance.longTermCare).toBe(14_170)
  })
})

describe('childcare child count from the snapshot', () => {
  const withChildcare: PayrollRowInputValue = {
    incomeType: 'WAGE_MONTHLY',
    basePay: 3_000_000,
    paymentItems: [{ code: 'CHILDCARE', name: '보육수당', amount: 500_000, nonTaxableCategory: 'CHILDCARE' }],
  }

  it('raises the childcare limit to 200,000 per qualifying child', () => {
    const result = calculateRow(withChildcare, { ...snapshot, childcareChildren: 2 }, context('2026-03', '2026-03'))

    expect(result.nonTaxablePay).toBe(400_000)
    expect(result.warnings.map((warning) => warning.code)).toEqual(['NON_TAXABLE_LIMIT_EXCEEDED'])
  })

  it('warns when the count was set for another tax year', () => {
    const stale = { ...snapshot, childcareChildren: 2, childcareChildrenEffectiveFrom: '2026-01-01' }
    const sameYear = calculateRow(withChildcare, stale, context('2026-12', '2026-12'))
    const nextYear = calculateRow(withChildcare, stale, context('2027-01', '2027-01'))

    expect(sameYear.warnings.map((warning) => warning.code)).not.toContain('CHILDCARE_CHILDREN_STALE')
    expect(nextYear.nonTaxablePay).toBe(400_000)
    expect(nextYear.warnings.map((warning) => warning.code)).toContain('CHILDCARE_CHILDREN_STALE')
  })

  it('keeps one 200,000 limit and warns for snapshots saved without the count', () => {
    const result = calculateRow(withChildcare, snapshot, context('2026-03', '2026-03'))

    expect(result.nonTaxablePay).toBe(200_000)
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'CHILDCARE_CHILDREN_UNKNOWN',
      'NON_TAXABLE_LIMIT_EXCEEDED',
    ])
  })
})

describe('calculateRow for other income codes (별지 제23호서식(4))', () => {
  const march = context('2026-03', '2026-03')

  it('uses 76 (강연료 등, 60% deemed expense) when the row has no code', () => {
    const result = calculateRow({ incomeType: 'OTHER', payAmount: 1_000_000 }, null, march)

    expect({ incomeTax: result.incomeTax, localIncomeTax: result.localIncomeTax }).toEqual({
      incomeTax: 80_000,
      localIncomeTax: 8_000,
    })
  })

  it('recalculates a row saved with 60 at 0% expense, since 60 is 필요경비가 없는 기타소득', () => {
    const result = calculateRow({ incomeType: 'OTHER', payAmount: 1_000_000, otherIncomeCode: '60' }, null, march)

    expect(result.incomeTax).toBe(200_000)
  })

  it('applies the 60% deemed expense of code 72', () => {
    const result = calculateRow({ incomeType: 'OTHER', payAmount: 1_000_000, otherIncomeCode: '72' }, null, march)

    expect(result.incomeTax).toBe(80_000)
  })

  it('warns when an artwork sale over 100,000,000 uses the flat 90% expense', () => {
    const over = calculateRow({ incomeType: 'OTHER', payAmount: 100_000_001, otherIncomeCode: '64' }, null, march)
    const atLimit = calculateRow({ incomeType: 'OTHER', payAmount: 100_000_000, otherIncomeCode: '64' }, null, march)
    const withActual = calculateRow(
      { incomeType: 'OTHER', payAmount: 150_000_000, otherIncomeCode: '64', necessaryExpenseAmount: 125_000_000 },
      null,
      march,
    )

    expect(over.warnings.map((warning) => warning.code)).toEqual(['ARTWORK_EXPENSE_RATE_SIMPLIFIED'])
    expect(atLimit.warnings).toEqual([])
    expect(withActual.warnings).toEqual([])
  })
})

describe('calculateRow for business income employment insurance', () => {
  const march = context('2026-03', '2026-03')

  it.each(['940923', '940921', '940924', '940925', '940100', '940909'])(
    'follows the row flag for %s, not the code',
    (code) => {
      const flagged = calculateRow(
        { incomeType: 'BUSINESS', payAmount: 1_000_000, businessIncomeCode: code, employmentInsuranceApplicable: true },
        null,
        march,
      )
      const unflagged = calculateRow(
        { incomeType: 'BUSINESS', payAmount: 1_000_000, businessIncomeCode: code },
        null,
        march,
      )

      expect(flagged.employeeInsurance.employmentInsurance).toBe(8_000)
      expect(unflagged.employeeInsurance.employmentInsurance).toBe(0)
    },
  )
})
