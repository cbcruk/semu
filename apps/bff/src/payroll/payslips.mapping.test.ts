import { describe, expect, it } from 'vitest'
import { LegacyError } from '../legacy-error.ts'
import type { Payslip, PayslipSendJob } from '../upstream.types.ts'
import {
  assertRowIdFormat,
  legacyFailReason,
  legacyNotificationStatus,
  legacySentAt,
  parsePayslipSave,
  parseRowIds,
  toLegacySendResults,
} from './payslips.mapping.ts'

const ROW_A = 'pyr_01JBQ00000000000000000000A'
const ROW_B = 'pyr_01JBQ00000000000000000000B'

function payslip(delivery: Partial<Payslip['delivery']> = {}): Payslip {
  return {
    id: 'psl_1',
    ledgerId: 'pyl_1',
    rowId: ROW_A,
    employeeId: null,
    payeeName: '김세무',
    incomeType: 'WAGE_MONTHLY',
    attributionMonth: '2026-09',
    paymentDate: '2026-09-25',
    payments: [],
    deductions: [],
    grossPay: 0,
    deductionTotal: 0,
    netPay: 0,
    delivery: { status: 'NOT_SENT', failureReason: null, attemptedAt: null, attempts: 0, ...delivery },
  }
}

function fieldsOf(run: () => unknown): Record<string, string[]> | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof LegacyError) return error.body.errors
    throw error
  }
  return undefined
}

describe('payslip delivery', () => {
  it('maps the last attempt to the legacy status, reason and sent time', () => {
    const at = '2026-10-01T00:00:00.000Z'

    expect(legacyNotificationStatus(undefined)).toBeNull()
    expect(legacyNotificationStatus(payslip())).toBeNull()
    expect(legacyNotificationStatus(payslip({ status: 'SENT' }))).toBe('success')
    expect(legacyNotificationStatus(payslip({ status: 'FAILED' }))).toBe('fail')
    expect(legacyFailReason('NO_EMAIL')).toBe('no_email')
    expect(legacyFailReason('REJECTED')).toBe('rejected')
    expect(legacyFailReason(null)).toBeNull()
    expect(legacySentAt(payslip({ status: 'SENT', attemptedAt: at }))).toBe(at)
    expect(legacySentAt(payslip({ status: 'FAILED', attemptedAt: at }))).toBeNull()
    expect(legacySentAt(undefined)).toBeNull()
  })

  it('maps job items back to rows and refuses a job for other payslips', () => {
    const job: PayslipSendJob = {
      id: 'job_1',
      status: 'PARTIALLY_SUCCEEDED',
      result: {
        items: [
          { payslipId: 'psl_1', status: 'SENT', failureReason: null },
          { payslipId: 'psl_9', status: 'FAILED', failureReason: 'NO_EMAIL' },
        ],
      },
      createdAt: '',
      finishedAt: '',
    }

    const requested = new Map([
      ['psl_1', ROW_A],
      ['psl_9', ROW_B],
    ])

    expect(toLegacySendResults(job, requested)).toEqual([
      { row_id: ROW_A, status: 'success', fail_reason: null },
      { row_id: ROW_B, status: 'fail', fail_reason: 'no_email' },
    ])
    for (const other of [
      new Map([['psl_1', ROW_A]]),
      new Map([...requested, ['psl_2', ROW_A]]),
      new Map([
        ['psl_1', ROW_A],
        ['psl_8', ROW_B],
      ]),
    ]) {
      expect(() => toLegacySendResults(job, other)).toThrow(LegacyError)
    }
  })
})

describe('legacy payslip bodies', () => {
  it('reads row IDs once each', () => {
    expect(parseRowIds({ row_ids: [ROW_B, ROW_A, ROW_B] })).toEqual([ROW_B, ROW_A])
    expect(parseRowIds({ row_ids: Array.from({ length: 500 }, () => ROW_A) })).toEqual([ROW_A])
    expect(fieldsOf(() => parseRowIds({ row_ids: null }))).toEqual({ row_ids: ['This field is required.'] })
    expect(parseRowIds({ row_ids: ['123'] })).toEqual(['123'])
    expect(fieldsOf(() => assertRowIdFormat([ROW_A, '123']))).toEqual({
      row_ids: ['Some rows are not on this payroll card.'],
    })
    expect(fieldsOf(() => assertRowIdFormat([ROW_A, ROW_B]))).toBeUndefined()
  })

  it('reads save entries, keeping a null email as no override', () => {
    expect(
      parsePayslipSave({
        wage_salary: [
          { id: ROW_A, email: 'a@example.com', payment_formulas: {} },
          { id: ROW_B, email: null },
        ],
      }),
    ).toEqual([
      { index: 0, id: ROW_A, email: 'a@example.com' },
      { index: 1, id: ROW_B, email: undefined },
    ])
    expect(parsePayslipSave({ wage_salary: Array.from({ length: 500 }, () => ({ id: ROW_A })) })).toHaveLength(500)
    expect(fieldsOf(() => parsePayslipSave({ wage_salary: [null] }))).toEqual({ 'wage_salary.0': ['Invalid value.'] })
    for (const email of ['a@b', 'a b@c.d', '@c.d', 'a@']) {
      expect(fieldsOf(() => parsePayslipSave({ wage_salary: [{ id: ROW_A, email }] }))).toEqual({
        'wage_salary.0.email': ['Invalid email address.'],
      })
    }
  })
})
