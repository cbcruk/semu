import { describe, expect, it } from 'vitest'
import { LegacyError } from '../legacy-error.ts'
import type { Payslip, PayrollIncomeType, PayrollLedger, PayrollRow, PayrollRowResult } from '../upstream.types.ts'
import {
  inGroup,
  parsePayslipGroup,
  toBpoCard,
  toBpoPayslipDetail,
  toBpoPayslipSummary,
  toBpoSendResults,
} from './bpo-payslips.mapping.ts'

const LEDGER: PayrollLedger = {
  id: 'pyl_1',
  kind: 'REGULAR',
  workflow: 'CLIENT_APPROVAL',
  status: 'CLOSED',
  step: 3,
  title: '2026년 09월 급여 대장',
  attributionMonth: '2026-09',
  paymentDate: '2026-09-25',
  paymentMonth: '2026-09',
  wagePeriod: { start: '2026-09-01', end: '2026-09-30' },
  rowCount: 1,
  totals: { grossPay: 0, deductionTotal: 0, netPay: 0, incomeTax: 0, localIncomeTax: 0, employerInsurance: 0 },
  rejection: null,
  reopenReason: null,
  withholdingFiled: false,
  allowedActions: [],
  warnings: [],
  calculatedAt: null,
  closedAt: '2026-09-20T00:00:00.000Z',
  version: 4,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
}

const premiums = {
  nationalPension: 0,
  healthInsurance: 0,
  longTermCare: 0,
  employmentInsurance: 0,
  industrialAccident: 0,
  total: 0,
}

const RESULT: PayrollRowResult = {
  rateTable: '2026',
  withholdingRateTable: '2026',
  payments: [
    { code: 'BASE', name: '기본급', amount: 3_000_000, taxableAmount: 3_000_000, nonTaxableAmount: 0, formula: 'f' },
  ],
  grossPay: 3_000_000,
  taxablePay: 3_000_000,
  nonTaxablePay: 0,
  employeeInsurance: premiums,
  employerInsurance: premiums,
  incomeTax: 10,
  localIncomeTax: 1,
  deductions: [{ code: 'INCOME_TAX', name: '소득세', amount: 10, formula: 'g' }],
  deductionTotal: 11,
  netPay: 2_999_989,
  breakdown: [],
  warnings: [],
}

function row(incomeType: PayrollIncomeType, result: PayrollRowResult | null = RESULT): PayrollRow {
  const input =
    incomeType === 'WAGE_HOURLY'
      ? { incomeType, hourlyWage: 10_000, weeklyHolidayWeeks: 4, work: { regularMinutes: 600, overtimeMinutes: 90 } }
      : { incomeType, payAmount: 100 }
  return {
    id: 'pyr_1',
    ledgerId: 'pyl_1',
    employeeId: null,
    payeeName: '김세무',
    incomeType,
    input,
    result,
    updatedAt: '2026-09-20T00:00:00.000Z',
  }
}

const SENT: Payslip['delivery'] = {
  status: 'SENT',
  failureReason: null,
  attemptedAt: '2026-09-26T00:00:00.000Z',
  attempts: 1,
}

describe('BPO payslip groups', () => {
  it('reads the four legacy groups and refuses others with the legacy 404', () => {
    expect(['wage', 'business', 'daily', 'other'].map(parsePayslipGroup)).toEqual([
      'wage',
      'business',
      'daily',
      'other',
    ])
    for (const value of ['wage-monthly', 'wage-salary', 'other-labor', undefined]) {
      try {
        parsePayslipGroup(value)
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(LegacyError)
        expect((error as LegacyError).body).toEqual({ detail: 'Payslip group not found.', code: 'NOT_FOUND' })
      }
    }
  })

  it('puts every wage pay unit in the wage group and the rest in their own', () => {
    expect(inGroup(row('WAGE_MONTHLY'), 'wage')).toBe(true)
    expect(inGroup(row('WAGE_DAILY'), 'wage')).toBe(true)
    expect(inGroup(row('WAGE_HOURLY'), 'wage')).toBe(true)
    expect(inGroup(row('DAILY'), 'wage')).toBe(false)
    expect(inGroup(row('DAILY'), 'daily')).toBe(true)
    expect(inGroup(row('BUSINESS'), 'business')).toBe(true)
    expect(inGroup(row('OTHER'), 'other')).toBe(true)
  })
})

describe('BPO payslip rows', () => {
  it('summarises a row with the new delivery and the BPO segment', () => {
    expect(toBpoPayslipSummary(row('WAGE_HOURLY'), { delivery: SENT } as Payslip, 'kim@example.com')).toEqual({
      row_id: 'pyr_1',
      id: 'pyr_1',
      name: '김세무',
      birth_date: null,
      income_type: 'wage-hourly',
      payslip_group: 'wage',
      department: null,
      email: 'kim@example.com',
      notification_status: 'success',
      sent_at: SENT.attemptedAt,
      fail_reason: null,
      net_pay: 2_999_989,
    })
  })

  it('previews the lines with formulas and the wage work sheet in hours', () => {
    const detail = toBpoPayslipDetail(LEDGER, row('WAGE_HOURLY'), undefined, null)

    expect(detail).toMatchObject({
      attribution_month: '2026-09',
      payment_date: '2026-09-25',
      payments: [{ code: 'BASE', name: '기본급', amount: 3_000_000, formula: 'f' }],
      deductions: [{ code: 'INCOME_TAX', name: '소득세', amount: 10, formula: 'g' }],
      gross_pay: 3_000_000,
      deduction_total: 11,
      net_pay: 2_999_989,
      payment_formulas: {},
      notification_status: null,
      work: expect.objectContaining({ regular_hours: 10, overtime_hours: 1.5, weekly_holiday_weeks: 4 }),
    })
  })

  it('previews an uncalculated or non-wage row with empty lines and no work sheet', () => {
    expect(toBpoPayslipDetail(LEDGER, row('BUSINESS', null), undefined, null)).toMatchObject({
      payments: [],
      deductions: [],
      gross_pay: 0,
      net_pay: 0,
      work: null,
    })
  })
})

describe('BPO card and send results', () => {
  it('keeps only the BPO card keys and the BPO status', () => {
    const card = toBpoCard({ ...LEDGER, status: 'PENDING_APPROVAL' }, [row('DAILY')], null)

    expect(card).toMatchObject({ generation: 'bpo', status: 'approval_requested', legacy_status: 'calculating' })
    expect(card['headcount_by_type']).toMatchObject({ daily: 1 })
    for (const key of ['attr_date', 'card_status', 'headcount', 'net_pay_total_by_type']) {
      expect(card).not.toHaveProperty(key)
    }
  })

  it('renames the status key to notification_status', () => {
    expect(toBpoSendResults([{ row_id: 'pyr_1', status: 'fail', fail_reason: 'no_email' }])).toEqual([
      { row_id: 'pyr_1', notification_status: 'fail', fail_reason: 'no_email' },
    ])
  })
})
