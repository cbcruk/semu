import { describe, expect, it } from 'vitest'
import { fromProblem, LegacyError } from '../legacy-error.ts'
import type { PayrollLedger, PayrollRow, PayrollRowInput, PayrollRowResult } from '../upstream.types.ts'
import {
  booleanQuery,
  legacyCardOrder,
  legacyCardStatus,
  legacyStatus,
  parentCardIdOf,
  parseLegacySegment,
  toLegacyAdditionalError,
  toLegacyInput,
  toLegacyRow,
  toLegacySummary,
} from './ledgers.mapping.ts'

function ledger(overrides: Partial<PayrollLedger> = {}): PayrollLedger {
  return {
    id: 'pyl_1',
    kind: 'REGULAR',
    workflow: 'DIRECT_CLOSE',
    status: 'DRAFT',
    step: 1,
    title: '2026년 9월 급여',
    attributionMonth: '2026-09',
    paymentDate: '2026-09-25',
    paymentMonth: '2026-09',
    wagePeriod: { start: '2026-09-01', end: '2026-09-30' },
    rowCount: 0,
    totals: { grossPay: 0, deductionTotal: 0, netPay: 0, incomeTax: 0, localIncomeTax: 0, employerInsurance: 0 },
    rejection: null,
    reopenReason: null,
    withholdingFiled: false,
    allowedActions: [],
    warnings: [],
    calculatedAt: null,
    closedAt: null,
    version: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const premiums = {
  nationalPension: 1,
  healthInsurance: 2,
  longTermCare: 3,
  employmentInsurance: 4,
  industrialAccident: 5,
  total: 15,
}

function result(grossPay: number, netPay: number): PayrollRowResult {
  return {
    rateTable: '2026-07',
    withholdingRateTable: '2026-07',
    payments: [],
    grossPay,
    taxablePay: grossPay,
    nonTaxablePay: 0,
    employeeInsurance: premiums,
    employerInsurance: { ...premiums, total: 30 },
    incomeTax: 7,
    localIncomeTax: 8,
    deductions: [],
    deductionTotal: grossPay - netPay,
    netPay,
    breakdown: [],
    warnings: [],
  }
}

function row(input: PayrollRowInput, calculated: PayrollRowResult | null, id = 'pyr_1'): PayrollRow {
  return {
    id,
    ledgerId: 'pyl_1',
    employeeId: null,
    payeeName: '정일용',
    incomeType: input.incomeType,
    input,
    result: calculated,
    updatedAt: '2026-09-02T00:00:00.000Z',
  }
}

describe('ledger status', () => {
  it('maps the four new states onto the legacy card status and its three steps', () => {
    expect(
      ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CLOSED'].map((status) => legacyCardStatus(status as any)),
    ).toEqual(['inputting', 'calculated', 'approval_requested', 'approved'])
    expect(['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CLOSED'].map((status) => legacyStatus(status as any))).toEqual([
      'input_available',
      'calculating',
      'calculating',
      'done',
    ])
  })
})

describe('legacy income type query', () => {
  it('accepts both spellings and treats empty as no filter', () => {
    expect(parseLegacySegment('wage_salary')).toBe('wage-salary')
    expect(parseLegacySegment('other-labor')).toBe('other-labor')
    expect(parseLegacySegment('')).toBeUndefined()
    expect(parseLegacySegment(null)).toBeUndefined()
    expect(() => parseLegacySegment('bonus')).toThrow('Income type not found.')
  })

  it('reads true/false flags strictly', () => {
    expect(booleanQuery(new URLSearchParams('a=true'), 'a')).toBe(true)
    expect(booleanQuery(new URLSearchParams('a=false'), 'a')).toBe(false)
    expect(booleanQuery(new URLSearchParams(''), 'a')).toBe(false)
    expect(() => booleanQuery(new URLSearchParams('a=1'), 'a')).toThrow(LegacyError)
  })
})

describe('row input', () => {
  it('spreads a wage input with hours, proration and items keyed by code', () => {
    expect(
      toLegacyInput({
        incomeType: 'WAGE_HOURLY',
        hourlyWage: 12_000,
        weeklyHolidayWeeks: 4,
        proration: { method: 'CALENDAR_DAYS', payableDays: 10, totalDays: 30 },
        paymentItems: [{ code: 'MEAL', name: '식대', amount: 200_000 }],
        otherDeductions: [{ code: 'CLUB', name: '동호회비', amount: 10_000 }],
        work: { regularMinutes: 90, overtimeMinutes: 30, weeklyHolidayDeductionDays: 1 },
        insuranceNotice: { healthInsurance: 50_000 },
      }),
    ).toEqual({
      base_pay: 0,
      hourly_wage: 12_000,
      daily_wage: 0,
      worked_days: 0,
      prorate_requested: true,
      proration: { payable_days: 10, total_days: 30 },
      payment_items: [{ item_id: 'MEAL', amount: 200_000 }],
      deduction_items: [{ item_id: 'CLUB', amount: 10_000 }],
      work: {
        regular_hours: 1.5,
        overtime_hours: 0.5,
        night_hours: 0,
        holiday_hours: 0,
        holiday_overtime_hours: 0,
        absence_hours: 0,
        weekly_holiday_deduction_days: 1,
        weekly_holiday_weeks: 4,
      },
      insurance_notice: { health_insurance: 50_000 },
    })
  })

  it('spreads daily, business and other inputs with the legacy defaults', () => {
    expect(toLegacyInput({ incomeType: 'DAILY', payAmount: 600_000, workDays: 3, averageDailyMinutes: 480 })).toEqual({
      pay_amount: 600_000,
      work_dates: [],
      work_days: 3,
      avg_daily_hours: 8,
      is_owner_or_cohabiting_relative: false,
      deduction_items: [],
    })
    expect(
      toLegacyInput({
        incomeType: 'BUSINESS',
        payAmount: 1_000_000,
        businessIncomeCode: '940909',
        taxDeductionMode: 'AFTER_TAX',
        employmentInsuranceApplicable: true,
      }),
    ).toEqual({
      pay_amount: 1_000_000,
      business_income_type_code: '940909',
      detail_type: null,
      employment_insurance_applicable: true,
      contract_type: null,
      short_term_work_dates: [],
      special_occ_type_code: null,
      tax_deduction_mode: 'after_tax',
    })
    expect(toLegacyInput({ incomeType: 'OTHER', payAmount: 300_000 })).toEqual({
      pay_amount: 300_000,
      other_income_type_code: null,
      tax_deduction_mode: 'before_tax',
      necessary_expense_amount: null,
    })
  })
})

describe('legacy row', () => {
  it('keeps uncalculated amounts at zero and only wage rows carry taxable incomes', () => {
    const daily = toLegacyRow(
      ledger(),
      row(
        {
          incomeType: 'DAILY',
          payAmount: 600_000,
          workDays: 3,
          otherDeductions: [{ code: 'MEAL', name: '식대', amount: 5_000 }],
        },
        null,
      ),
    )

    expect(daily).toMatchObject({
      income_type: 'daily',
      wage_type: 'daily',
      is_calculated: false,
      calculated_at: null,
      gross_pay: 0,
      net_pay: 0,
      calculation: null,
      taxable_incomes: {},
      other_deductions: { MEAL: 5_000 },
    })
  })

  it('maps the calculation and the premiums', () => {
    const other = toLegacyRow(ledger(), row({ incomeType: 'OTHER', payAmount: 100 }, result(100, 80)))

    expect(other).toMatchObject({
      income_type: 'other-labor',
      calculated_at: '2026-09-02T00:00:00.000Z',
      employee_insurance_total: 15,
      employer_insurance_total: 30,
      calculation: {
        type: 'other',
        income_type: 'other',
        attribution_month: '2026-09',
        national_pension: 1,
        long_term_care_insurance: 3,
        employer: { industrial_accident_insurance: 5, total: 30 },
      },
    })
  })
})

describe('legacy summary', () => {
  it('counts rows by type, sums only calculated amounts and maps the dates', () => {
    const summary = toLegacySummary(
      ledger({
        kind: 'ADDITIONAL',
        status: 'SUBMITTED',
        rejection: { reason: '다시', rejectedAt: '2026-09-03T00:00:00.000Z' },
        withholdingFiled: true,
      }),
      [
        row({ incomeType: 'DAILY', payAmount: 1 }, result(100, 90), 'pyr_1'),
        row({ incomeType: 'DAILY', payAmount: 1 }, null, 'pyr_2'),
        row({ incomeType: 'BUSINESS', payAmount: 1 }, result(50, 40), 'pyr_3'),
      ],
      'pyl_0',
    )

    expect(summary).toMatchObject({
      kind: 'addition',
      parent_card_id: 'pyl_0',
      status: 'calculating',
      card_status: 'calculated',
      rejected_at: '2026-09-03T00:00:00.000Z',
      headcount: { wage_salary: 0, daily: 2, business: 1, other_labor: 0 },
      headcount_by_type: { daily: 2, business: 1, other: 0 },
      total_by_type: { daily: { gross_pay: 100, net_pay: 90 }, business: { gross_pay: 50, net_pay: 40 } },
      net_pay_total_by_type: { daily: 90, business: 40 },
      gross_total: 150,
      net_total: 130,
      uncalculated_count: 1,
      withholding_filed: true,
    })
  })
})

describe('card order and parents', () => {
  it('orders newest month first, additional cards before the regular one, then by creation', () => {
    const cards = [
      ledger({ id: 'pyl_a', attributionMonth: '2026-08' }),
      ledger({ id: 'pyl_c', kind: 'ADDITIONAL' }),
      ledger({ id: 'pyl_b' }),
      ledger({ id: 'pyl_d', kind: 'ADDITIONAL' }),
    ]

    expect(legacyCardOrder(cards).map((card) => card.id)).toEqual(['pyl_c', 'pyl_d', 'pyl_b', 'pyl_a'])
  })

  it('finds the regular ledger of the same month as the parent', () => {
    const regular = ledger({ id: 'pyl_r' })
    const otherMonth = ledger({ id: 'pyl_o', attributionMonth: '2026-08' })
    const addition = ledger({ id: 'pyl_x', kind: 'ADDITIONAL' })

    expect(parentCardIdOf(addition, [otherMonth, regular, addition])).toBe('pyl_r')
    expect(parentCardIdOf(addition, [otherMonth])).toBeNull()
    expect(parentCardIdOf(regular, [regular])).toBeNull()
  })
})

describe('payroll errors', () => {
  it('maps the new additional ledger reasons to the legacy reasons', () => {
    const reasons = [
      'NO_REGULAR_LEDGER',
      'REGULAR_LEDGER_NOT_SUBMITTED',
      'DRAFT_LEDGER_EXISTS',
      'WITHHOLDING_DEADLINE_NEAR',
    ].map(
      (reason) =>
        toLegacyAdditionalError(fromProblem(409, { code: 'ADDITIONAL_LEDGER_BLOCKED', title: 'Blocked', reason })).body,
    )

    expect(reasons).toEqual(
      ['no_default_card', 'parent_not_calculated', 'input_card_exists', 'withholding_deadline_near'].map((reason) => ({
        detail: 'Blocked.',
        code: 'ADDITIONAL_CARD_NOT_ALLOWED',
        reason,
      })),
    )
  })

  it('leaves other errors alone', () => {
    const error = fromProblem(409, { code: 'WITHHOLDING_FILED', paymentMonth: '2026-09' })

    expect(toLegacyAdditionalError(error)).toBe(error)
    expect(error.body).toMatchObject({ code: 'WITHHOLDING_FILED', payment_month: '2026-09' })
  })

  it('maps the payroll codes the legacy client knew', () => {
    const map = (code: string, status: number) => {
      const error = fromProblem(status, { code })
      return [error.status, error.body.code]
    }

    expect(map('PAYROLL_LEDGER_READ_ONLY', 409)).toEqual([409, 'INVALID_TRANSITION'])
    expect(map('PAYROLL_LEDGER_TRANSITION_INVALID', 409)).toEqual([409, 'INVALID_TRANSITION'])
    expect(map('WAGE_ROW_ON_ADDITIONAL_LEDGER', 409)).toEqual([409, 'WAGE_INCOME_ON_ADDITIONAL_CARD'])
    expect(map('RATE_TABLE_NOT_FOUND', 422)).toEqual([422, 'RATE_TABLE_NOT_FOUND'])
  })
})
