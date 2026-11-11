import { describe, expect, it } from 'vitest'
import { calculatePayrollRow } from '../engine/payroll-row.ts'
import { resolveRateTable } from '../engine/rate-table.ts'
import { BUILT_IN_RATE_TABLES, RATES_2026_01, RATES_2026_03 } from '../engine/rate-tables-2026.ts'
import { catalogOf } from '../items/payroll-item-rules.ts'
import { categoryPaymentItem } from '../items/payroll-item.testing.ts'
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
const childcareItem = categoryPaymentItem('CHILDCARE')
const catalog = catalogOf([childcareItem], [])

function context(attributionMonth: string, paymentMonth: string): RowCalculationContext {
  return {
    attributionMonth,
    attributionRates: resolveRateTable(BUILT_IN_RATE_TABLES, attributionMonth),
    paymentRates: resolveRateTable(BUILT_IN_RATE_TABLES, paymentMonth),
    setting,
    catalog,
  }
}

describe('기준표가 바뀌는 달의 calculateRow', () => {
  it('3월에 지급한 2월 귀속 행은 3월 자녀세액공제로 원천징수합니다', () => {
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

  it('2026년 11월 전후로 보험료는 귀속월, 세액은 지급월 기준표를 씁니다', () => {
    const october = calculateRow(input, snapshot, context('2026-10', '2026-11'))
    const november = calculateRow(input, snapshot, context('2026-11', '2026-11'))

    expect([october.rateTable, october.withholdingRateTable]).toEqual(['2026-07', '2026-11'])
    expect([november.rateTable, november.withholdingRateTable]).toEqual(['2026-11', '2026-11'])
    // 3,000,000 × 3.595% = 107,850; × 13.14% = 14,171.49 → 14,170 (두 기준표 모두 131,400ppm)
    expect(october.employeeInsurance.longTermCare).toBe(14_170)
    expect(november.employeeInsurance.longTermCare).toBe(14_170)
  })
})

describe('직원 정보 사본의 보육수당 자녀 수', () => {
  const withChildcare: PayrollRowInputValue = {
    incomeType: 'WAGE_MONTHLY',
    basePay: 3_000_000,
    paymentItems: [{ itemId: childcareItem.id, amount: 500_000 }],
  }

  it('보육수당 비과세 한도는 대상 자녀 1명당 200,000원입니다', () => {
    const result = calculateRow(withChildcare, { ...snapshot, childcareChildren: 2 }, context('2026-03', '2026-03'))

    expect(result.nonTaxablePay).toBe(400_000)
    expect(result.warnings.map((warning) => warning.code)).toEqual(['NON_TAXABLE_LIMIT_EXCEEDED'])
  })

  it('자녀 수를 다른 과세연도에 정했으면 경고합니다', () => {
    const stale = { ...snapshot, childcareChildren: 2, childcareChildrenEffectiveFrom: '2026-01-01' }
    const sameYear = calculateRow(withChildcare, stale, context('2026-12', '2026-12'))
    const nextYear = calculateRow(withChildcare, stale, context('2027-01', '2027-01'))

    expect(sameYear.warnings.map((warning) => warning.code)).not.toContain('CHILDCARE_CHILDREN_STALE')
    expect(nextYear.nonTaxablePay).toBe(400_000)
    expect(nextYear.warnings.map((warning) => warning.code)).toContain('CHILDCARE_CHILDREN_STALE')
  })

  it('자녀 수 없이 저장한 사본은 한도 200,000원 하나로 보고 경고합니다', () => {
    const result = calculateRow(withChildcare, snapshot, context('2026-03', '2026-03'))

    expect(result.nonTaxablePay).toBe(200_000)
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'CHILDCARE_CHILDREN_UNKNOWN',
      'NON_TAXABLE_LIMIT_EXCEEDED',
    ])
  })
})

describe('기타소득 코드별 calculateRow (별지 제23호서식(4))', () => {
  const march = context('2026-03', '2026-03')

  it('코드가 없는 행은 76(강연료 등, 의제필요경비 60%)으로 봅니다', () => {
    const result = calculateRow({ incomeType: 'OTHER', payAmount: 1_000_000 }, null, march)

    expect({ incomeTax: result.incomeTax, localIncomeTax: result.localIncomeTax }).toEqual({
      incomeTax: 80_000,
      localIncomeTax: 8_000,
    })
  })

  it('60으로 저장한 행은 필요경비가 없는 기타소득이라 필요경비 0%로 다시 계산합니다', () => {
    const result = calculateRow({ incomeType: 'OTHER', payAmount: 1_000_000, otherIncomeCode: '60' }, null, march)

    expect(result.incomeTax).toBe(200_000)
  })

  it('코드 72는 의제필요경비 60%를 적용합니다', () => {
    const result = calculateRow({ incomeType: 'OTHER', payAmount: 1_000_000, otherIncomeCode: '72' }, null, march)

    expect(result.incomeTax).toBe(80_000)
  })

  it('100,000,000원을 넘는 서화·골동품 양도에 필요경비 90%를 일괄 적용하면 경고합니다', () => {
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

describe('사업소득 고용보험의 calculateRow', () => {
  const march = context('2026-03', '2026-03')

  it.each(['940923', '940921', '940924', '940925', '940100', '940909'])(
    '%s는 코드가 아니라 행의 고용보험 적용 여부를 따릅니다',
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
