import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { RATES_2026_01 } from '../engine/rate-tables-2026.ts'
import { withholdingTotalsPaidIn } from '../ledgers/pay-month.ts'
import type { PayrollLedgerRecord, PayrollRowRecord } from '../ledgers/payroll-ledger.types.ts'
import {
  calculateWageSettlement,
  defaultSettlementPaymentDate,
  earliestSettlementPaymentDate,
  wageSettlementMonthsChanged,
  wageSettlementMonthsTouched,
  wageSettlementRejectionOf,
  wageSettlementWithholdingPaidIn,
  wageYearTotalsOf,
} from './wage-tax-settlement-rules.ts'
import type { WageTaxSettlementRecord, WageYearTotals } from './wage-tax-settlement.types.ts'

const EMPLOYEE = 'emp_01JBQ000000000000000000001' as Id<'employee'>
const OTHER = 'emp_01JBQ000000000000000000002' as Id<'employee'>

/** 계산 결과에서 정산이 읽는 필드만 채운 대장 행입니다. */
function row(employeeId: Id<'employee'>, incomeType: string, taxablePay: number, incomeTax: number): PayrollRowRecord {
  return {
    employeeId,
    input: { incomeType },
    result: {
      grossPay: taxablePay + 200_000,
      taxablePay,
      employeeInsurance: {
        nationalPension: 142_500,
        healthInsurance: 107_850,
        longTermCare: 14_160,
        employmentInsurance: 27_000,
      },
      incomeTax,
      localIncomeTax: incomeTax / 10,
    },
  } as unknown as PayrollRowRecord
}

function ledger(attributionMonth: string, status: PayrollLedgerRecord['status'], rows: PayrollRowRecord[]) {
  return { attributionMonth, status, rows } as unknown as PayrollLedgerRecord
}

const YEAR_TOTALS: WageYearTotals = {
  months: ['2026-01'],
  grossPay: 38_400_000,
  taxablePay: 36_000_000,
  nationalPension: 1_710_000,
  healthInsurance: 1_500_000,
  employmentInsurance: 324_000,
  withheldIncomeTax: 1_000_000,
  withheldLocalIncomeTax: 100_000,
}

describe('wageYearTotalsOf', () => {
  it('그해 귀속의 마감된 대장에서 그 직원의 근로 행만 더합니다', () => {
    const totals = wageYearTotalsOf(
      [
        ledger('2026-01', 'CLOSED', [
          row(EMPLOYEE, 'WAGE_MONTHLY', 3_000_000, 74_350),
          row(OTHER, 'WAGE_MONTHLY', 9_000_000, 900_000),
        ]),
        ledger('2026-02', 'CLOSED', [
          row(EMPLOYEE, 'WAGE_MONTHLY', 3_000_000, 74_350),
          row(EMPLOYEE, 'BUSINESS', 1_000_000, 30_000),
        ]),
        ledger('2026-03', 'DRAFT', [row(EMPLOYEE, 'WAGE_MONTHLY', 3_000_000, 74_350)]),
        ledger('2025-12', 'CLOSED', [row(EMPLOYEE, 'WAGE_MONTHLY', 3_000_000, 74_350)]),
      ],
      EMPLOYEE,
      '2026',
    )

    expect(totals).toEqual({
      months: ['2026-01', '2026-02'],
      grossPay: 6_400_000,
      taxablePay: 6_000_000,
      nationalPension: 285_000,
      healthInsurance: 244_020,
      employmentInsurance: 54_000,
      withheldIncomeTax: 148_700,
      withheldLocalIncomeTax: 14_870,
    })
  })
})

describe('wageSettlementRejectionOf', () => {
  const base = { year: '2026', joinDate: '2024-01-01', today: '2027-01-10', totals: YEAR_TOTALS }

  it.each([
    ['재직 중', null, 'NOT_LEFT_IN_YEAR'],
    ['12월 31일 퇴사', '2026-12-31', 'NOT_LEFT_IN_YEAR'],
    ['다른 해 퇴사', '2025-06-30', 'NOT_LEFT_IN_YEAR'],
    ['그해 중간 퇴사', '2026-03-31', null],
  ] as const)('중도퇴사 정산은 %s이면 %s입니다', (_, leaveDate, expected) => {
    expect(wageSettlementRejectionOf({ ...base, kind: 'MID_YEAR', leaveDate })).toBe(expected)
  })

  it('연말정산은 그해가 끝나야 하고 12월 31일에 재직해야 합니다', () => {
    expect(wageSettlementRejectionOf({ ...base, kind: 'ANNUAL', leaveDate: null, today: '2026-12-31' })).toBe(
      'YEAR_NOT_ENDED',
    )
    expect(wageSettlementRejectionOf({ ...base, kind: 'ANNUAL', leaveDate: '2026-10-31' })).toBe(
      'NOT_EMPLOYED_AT_YEAR_END',
    )
    expect(wageSettlementRejectionOf({ ...base, kind: 'ANNUAL', joinDate: '2027-01-02', leaveDate: null })).toBe(
      'NOT_EMPLOYED_AT_YEAR_END',
    )
    expect(wageSettlementRejectionOf({ ...base, kind: 'ANNUAL', leaveDate: '2026-12-31' })).toBeNull()
  })

  it('그해 마감된 근로소득이 없으면 정산할 수 없습니다', () => {
    expect(
      wageSettlementRejectionOf({ ...base, kind: 'ANNUAL', leaveDate: null, totals: { ...YEAR_TOTALS, months: [] } }),
    ).toBe('NO_WAGE_IN_YEAR')
  })
})

describe('지급일', () => {
  it('기본값은 중도퇴사는 퇴사일, 연말정산은 다음 해 2월 말일입니다', () => {
    expect(defaultSettlementPaymentDate('MID_YEAR', '2026', '2026-03-31')).toBe('2026-03-31')
    expect(defaultSettlementPaymentDate('ANNUAL', '2027', null)).toBe('2028-02-29')
  })

  it('가장 이른 날은 중도퇴사는 그해 1월 1일, 연말정산은 다음 해 1월 1일입니다', () => {
    expect(earliestSettlementPaymentDate('MID_YEAR', '2026')).toBe('2026-01-01')
    expect(earliestSettlementPaymentDate('ANNUAL', '2026')).toBe('2027-01-01')
  })
})

describe('calculateWageSettlement', () => {
  it('특별소득공제가 표준세액공제보다 유리하면 특별공제로 결정세액을 계산합니다', () => {
    // 총급여 3,600만원: 근로소득공제 750만 + (3,600만 − 1,500만) × 15% = 1,065만
    // 과세표준 2,535만 − 150만 − 171만 − 182.4만 = 2,031.6만 → 산출세액 2,031.6만 × 15% − 126만 = 1,787,400
    // 근로소득세액공제 min(71.5만 + 48.74만 × 30%, 74만 − 300만 × 0.8%) = 716,000 → 결정세액 1,071,400
    const result = calculateWageSettlement(YEAR_TOTALS, 1, {}, RATES_2026_01)

    expect(result).toEqual({
      totalPay: 36_000_000,
      earnedIncomeDeduction: 10_650_000,
      earnedIncome: 25_350_000,
      personalDeduction: 1_500_000,
      pensionDeduction: 1_710_000,
      insuranceDeduction: 1_824_000,
      otherIncomeDeductions: 0,
      taxBase: 20_316_000,
      calculatedTax: 1_787_400,
      earnedIncomeCredit: 716_000,
      standardTaxCredit: 0,
      otherTaxCredits: 0,
      deductionMethod: 'ITEMIZED',
      determinedTax: 1_071_400,
      determinedLocalIncomeTax: 107_140,
      withheldIncomeTax: 1_000_000,
      withheldLocalIncomeTax: 100_000,
      balanceIncomeTax: 71_400,
      balanceLocalIncomeTax: 7_140,
    })
  })

  it('특별공제할 것이 없으면 표준세액공제 13만원을 받습니다', () => {
    // 과세표준 2,214만 → 산출세액 2,061,000 − 716,000 − 130,000 = 1,215,000 (특별공제면 1,345,000)
    const result = calculateWageSettlement(
      { ...YEAR_TOTALS, healthInsurance: 0, employmentInsurance: 0 },
      1,
      {},
      RATES_2026_01,
    )

    expect(result).toMatchObject({
      deductionMethod: 'STANDARD',
      insuranceDeduction: 0,
      standardTaxCredit: 130_000,
      determinedTax: 1_215_000,
    })
  })

  it('기납부세액이 결정세액보다 많으면 차감징수세액이 음수(환급)이고 끝수는 0 쪽으로 버립니다', () => {
    const result = calculateWageSettlement(
      { ...YEAR_TOTALS, withheldIncomeTax: 1_000_005, withheldLocalIncomeTax: 100_003 },
      1,
      { otherTaxCredits: 200_000 },
      RATES_2026_01,
    )

    expect(result).toMatchObject({
      otherTaxCredits: 200_000,
      determinedTax: 871_400,
      determinedLocalIncomeTax: 87_140,
      balanceIncomeTax: -128_600,
      balanceLocalIncomeTax: -12_860,
    })
  })

  it('공제대상가족이 늘면 1명에 150만원씩 인적공제합니다', () => {
    expect(calculateWageSettlement(YEAR_TOTALS, 3, {}, RATES_2026_01).personalDeduction).toBe(4_500_000)
  })
})

describe('원천세 줄', () => {
  let sequence = 0
  const settlement = (overrides: Partial<WageTaxSettlementRecord>): WageTaxSettlementRecord => {
    sequence += 1
    return {
      id: `wts_${String(sequence).padStart(26, '0')}` as Id<'wageTaxSettlement'>,
      companyId: TEST_COMPANY_ID,
      employeeId: EMPLOYEE,
      employeeName: '김하나',
      kind: 'MID_YEAR',
      year: '2026',
      joinDate: '2024-01-01',
      leaveDate: '2026-03-31',
      dependants: 1,
      input: {},
      totals: YEAR_TOTALS,
      result: calculateWageSettlement(YEAR_TOTALS, 1, {}, RATES_2026_01),
      rateTable: '2026-01',
      paymentDate: '2026-03-31',
      status: 'COMPLETED',
      version: 1,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('지급월의 확정 정산만 종류별로 모아 근로 간이세액 다음에 둡니다', () => {
    const lines = wageSettlementWithholdingPaidIn(
      [
        settlement({}),
        settlement({ employeeId: OTHER }),
        settlement({ status: 'CALCULATED' }),
        settlement({ paymentDate: '2026-04-10' }),
        settlement({ kind: 'ANNUAL', paymentDate: '2026-03-10' }),
      ],
      '2026-03',
    )

    expect(lines).toEqual([
      {
        incomeKind: 'WAGE_MID_YEAR_SETTLEMENT',
        otherIncomeCategory: null,
        headcount: 2,
        grossPay: 76_800_000,
        taxablePay: 72_000_000,
        incomeTax: 142_800,
        localIncomeTax: 14_280,
      },
      {
        incomeKind: 'WAGE_ANNUAL_SETTLEMENT',
        otherIncomeCategory: null,
        headcount: 1,
        grossPay: 38_400_000,
        taxablePay: 36_000_000,
        incomeTax: 71_400,
        localIncomeTax: 7_140,
      },
    ])
    const totals = withholdingTotalsPaidIn(
      [
        {
          ...ledger('2026-03', 'CLOSED', [row(EMPLOYEE, 'WAGE_MONTHLY', 3_000_000, 74_350)]),
          paymentDate: '2026-03-25',
        },
      ],
      '2026-03',
      [],
      lines,
    )
    expect(totals.map((line) => line.incomeKind)).toEqual([
      'WAGE',
      'WAGE_MID_YEAR_SETTLEMENT',
      'WAGE_ANNUAL_SETTLEMENT',
    ])
  })

  it('확정·다시 열기는 지급월 합계를 바꾸고, 지급일을 새로 정하면 그 달을 건드립니다', () => {
    const calculated = settlement({ status: 'CALCULATED' })
    const { paymentDate: _, ...undated } = calculated

    expect(wageSettlementMonthsChanged(calculated, settlement({}))).toEqual(['2026-03'])
    expect(wageSettlementMonthsChanged(settlement({}), calculated)).toEqual(['2026-03'])
    expect(wageSettlementMonthsChanged(undated, calculated)).toEqual([])
    expect(wageSettlementMonthsTouched(undated, calculated)).toEqual(['2026-03'])
    expect(wageSettlementMonthsTouched(calculated, { ...calculated, paymentDate: '2026-04-10' })).toEqual(['2026-04'])
  })
})
