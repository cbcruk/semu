import { describe, expect, it } from 'vitest'
import { LegacyFields } from '../legacy-body.ts'
import { LegacyError, legacyErrors, renameFieldErrors } from '../legacy-error.ts'
import type { Employee, Leave } from '../upstream.types.ts'
import {
  fromLegacyPayrollContract,
  fromLegacyWorkContract,
  payrollContractField,
  toLegacyWorkContract,
  workContractField,
} from './contracts.mapping.ts'
import { changesBesidesReturn, fromLegacyLeave } from './leaves.mapping.ts'
import { retirementChange, toLegacyResignationError } from './retirement.mapping.ts'

describe('work contract mapping', () => {
  it('reads the probation pay rate as percent, defaulting to 100 like the legacy server', () => {
    expect(
      fromLegacyWorkContract({ contract_type: 'contract', start_date: '2026-01-01', end_date: '2026-12-31' }),
    ).toEqual({ contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31' })
    expect(fromLegacyWorkContract({ contract_type: 'regular', start_date: '2026-01-01', has_probation: true })).toEqual(
      { contractType: 'PERMANENT', startDate: '2026-01-01', probation: { payRatePpm: 1_000_000 } },
    )
  })

  it('writes the ppm rate back as percent', () => {
    const row = toLegacyWorkContract({
      id: 'wct_1',
      employeeId: 'emp_1',
      contractType: 'PERMANENT',
      startDate: '2026-01-01',
      probation: { months: 3, payRatePpm: 900_000 },
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(row).toMatchObject({
      contract_type: 'regular',
      has_probation: true,
      probation_months: 3,
      probation_pay_rate: 90,
    })
  })

  it('renames nested violation fields', () => {
    expect(workContractField('probation.pay_rate_ppm')).toBe('probation_pay_rate')
    expect(payrollContractField('fixed_allowances.holiday_overtime.hours')).toBe('fixed_holiday_overtime_hours')
    expect(payrollContractField('payment_items.0.payment_item_id')).toBe('payment_items')
    expect(payrollContractField('account.account_number')).toBe('account_number')
    expect(payrollContractField('pay_timing.day')).toBe('pay_day')
    expect(payrollContractField('amount')).toBe('amount')
  })
})

describe('payroll contract mapping', () => {
  const base = { start_date: '2026-01-01', wage_type: 'hourly', amount: 11_000 }

  it('fills the legacy defaults', () => {
    const { input } = fromLegacyPayrollContract({ ...base, pay_method: 'direct' })

    expect(input).toMatchObject({
      wageType: 'HOURLY',
      monthlyWorkHours: 209,
      monthlyWorkHoursSource: 'MANUAL',
      paymentItems: [],
      payTiming: { month: 'CURRENT', day: 25 },
      payMethod: 'CASH',
    })
    expect(input.account).toBeUndefined()
  })

  it('keeps the stored account when the number is masked or missing', () => {
    const transfer = { ...base, bank_code: '004', account_holder: '김세무' }

    expect(fromLegacyPayrollContract({ ...transfer, account_number: '****6789' }).keepAccountNumber).toEqual({
      bankCode: '004',
      accountHolder: '김세무',
    })
    expect(fromLegacyPayrollContract(transfer).keepAccountNumber).toBeDefined()
    expect(fromLegacyPayrollContract({ ...transfer, account_number: '110123456789' }).input.account).toEqual({
      bankCode: '004',
      accountNumber: '110123456789',
      accountHolder: '김세무',
    })
  })

  it('needs a bonus amount when there is a bonus', () => {
    expect(() => fromLegacyPayrollContract({ ...base, pay_method: 'direct', has_bonus: true })).toThrowError(
      expect.objectContaining({
        status: 422,
        body: expect.objectContaining({ errors: { bonus_amount: expect.any(Array) } }),
      }),
    )
  })
})

describe('leave mapping', () => {
  const current: Leave = {
    id: 'lev_1',
    employeeId: 'emp_1',
    reason: 'PARENTAL',
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    expectedReturnDate: '2026-07-01',
    includeInServiceYears: true,
    npsPaymentException: false,
    nhisNoticeDeferral: false,
    version: 1,
  }

  it('treats the legacy body that only adds a return date as no other change', () => {
    const { create, actualReturnDate } = fromLegacyLeave({
      reason: 'parental',
      start_date: '2026-01-01',
      end_date: '2026-06-30',
      actual_return_date: '2026-05-01',
    })

    expect(changesBesidesReturn(current, create)).toBe(false)
    expect(actualReturnDate).toBe('2026-05-01')
  })

  it('sees edits to other fields', () => {
    const { create } = fromLegacyLeave({ reason: 'etc', start_date: '2026-01-01', end_date: '2026-06-30' })

    expect(changesBesidesReturn(current, create)).toBe(true)
    expect(create.reason).toBe('OTHER')
  })

  it('compares the expected return date, reading a missing one as the day after the end', () => {
    const body = { reason: 'parental', start_date: '2026-01-01', end_date: '2026-06-30' }
    const extended = { ...current, expectedReturnDate: '2026-08-01' }

    expect(changesBesidesReturn(current, fromLegacyLeave({ ...body, expected_return_date: null }).create)).toBe(false)
    expect(changesBesidesReturn(extended, fromLegacyLeave({ ...body, expected_return_date: null }).create)).toBe(true)
    expect(changesBesidesReturn(current, fromLegacyLeave({ ...body, expected_return_date: '2026-07-15' }).create)).toBe(
      true,
    )
  })
})

describe('retirement mapping', () => {
  const employee = (resignation?: Employee['resignation']): Employee => ({
    id: 'emp_1',
    kind: 'WAGE',
    name: '김세무',
    joinDate: '2025-03-02',
    isRejoin: false,
    isForeigner: false,
    status: resignation === undefined ? 'JOINED' : 'RESIGNED',
    warnings: [],
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(resignation === undefined ? {} : { resignation }),
  })
  const resigned = employee({ leaveDate: '2026-10-31', leavingReasonCode: '11' })

  it('decides between resign, cancel and nothing', () => {
    expect(retirementChange(employee(), {})).toEqual({ kind: 'none' })
    expect(retirementChange(resigned, { leave_date: null })).toEqual({ kind: 'cancel' })
    expect(retirementChange(resigned, { leave_date: '2026-10-31', leaving_reason: '11' })).toEqual({ kind: 'none' })
    expect(retirementChange(resigned, { leave_date: '2026-10-31', leaving_reason: '12' })).toEqual({
      kind: 'resign',
      resignation: { leaveDate: '2026-10-31', leavingReasonCode: '12' },
      leaveDateChanged: false,
    })
    expect(retirementChange(employee(), { leave_date: '2026-10-31', leaving_reason: '11' })).toMatchObject({
      leaveDateChanged: true,
    })
  })

  it('needs a reason with a leave date', () => {
    expect(() => retirementChange(employee(), { leave_date: '2026-10-31' })).toThrowError(
      expect.objectContaining({ body: expect.objectContaining({ errors: { leaving_reason: expect.any(Array) } }) }),
    )
  })

  it('turns resignation rejections into legacy field errors', () => {
    const rejected = new LegacyError(422, {
      detail: 'x',
      code: 'RESIGNATION_REJECTED',
      reason: 'LEAVING_REASON_INVALID',
    })
    const other = legacyErrors.notFound('Employee')

    expect(toLegacyResignationError(rejected)).toMatchObject({
      body: { errors: { leaving_reason: expect.any(Array) } },
    })
    expect(toLegacyResignationError(other)).toBe(other)
  })
})

describe('legacy body fields', () => {
  it('rejects wrong types and unsupported non-default values', () => {
    const fields = new LegacyFields({ a: 'yes', b: '2026/01/01', c: 'x', d: 'regular' })

    expect(() => fields.boolean('a', false)).toThrowError(LegacyError)
    expect(() => fields.optionalDate('b')).toThrowError(LegacyError)
    expect(() => fields.unsupported('c')).toThrowError(LegacyError)
    expect(() => fields.unsupported('d', 'regular')).not.toThrow()
    expect(() => fields.unsupported('missing')).not.toThrow()
  })

  it('renames field errors and merges ones that land on the same legacy field', () => {
    const error = new LegacyError(422, {
      detail: 'x',
      code: 'VALIDATION_FAILED',
      errors: { 'payment_items.0.amount': ['A'], 'payment_items.1.amount': ['B'] },
    })

    expect(renameFieldErrors(error, payrollContractField).body.errors).toEqual({ payment_items: ['A', 'B'] })
  })
})
