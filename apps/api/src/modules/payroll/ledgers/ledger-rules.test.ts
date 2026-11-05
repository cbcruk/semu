import { describe, expect, it } from 'vitest'
import { allowedActions, decideTransition, stepOf, transitionsOf } from './ledger-status.ts'
import {
  additionalLedgerBlocker,
  defaultPaymentDate,
  duplicatedWageIncome,
  wagePeriodOf,
  withholdingDeadlineOf,
} from './ledger-rules.ts'

describe('ledger transitions', () => {
  it('runs the client approval flow', () => {
    const base = { workflow: 'CLIENT_APPROVAL', withholdingFiled: false } as const
    expect(decideTransition('SUBMIT', { ...base, status: 'DRAFT', actor: 'CLIENT' })).toEqual({
      ok: true,
      to: 'SUBMITTED',
    })
    expect(decideTransition('REQUEST_APPROVAL', { ...base, status: 'SUBMITTED', actor: 'AGENCY' })).toEqual({
      ok: true,
      to: 'PENDING_APPROVAL',
    })
    expect(decideTransition('APPROVE', { ...base, status: 'PENDING_APPROVAL', actor: 'CLIENT' })).toEqual({
      ok: true,
      to: 'CLOSED',
    })
  })

  it('keeps approval for the client and the request for the agency', () => {
    const base = { workflow: 'CLIENT_APPROVAL', withholdingFiled: false } as const
    expect(decideTransition('APPROVE', { ...base, status: 'PENDING_APPROVAL', actor: 'AGENCY' }).ok).toBe(false)
    expect(decideTransition('REQUEST_APPROVAL', { ...base, status: 'SUBMITTED', actor: 'CLIENT' }).ok).toBe(false)
    expect(decideTransition('RETURN_TO_DRAFT', { ...base, status: 'SUBMITTED', actor: 'CLIENT' }).ok).toBe(false)
    expect(decideTransition('CLOSE', { ...base, status: 'SUBMITTED', actor: 'AGENCY' }).ok).toBe(false)
  })

  it('closes directly without approval in the self-service flow', () => {
    const base = { workflow: 'DIRECT_CLOSE', withholdingFiled: false, actor: 'CLIENT' } as const
    expect(decideTransition('CLOSE', { ...base, status: 'DRAFT' })).toEqual({ ok: true, to: 'CLOSED' })
    expect(decideTransition('REQUEST_APPROVAL', { ...base, status: 'SUBMITTED' }).ok).toBe(false)
    expect(transitionsOf('DIRECT_CLOSE')).toEqual(['SUBMIT', 'RETURN_TO_DRAFT', 'CLOSE', 'REOPEN'])
  })

  it('locks amount-changing transitions once withholding is filed', () => {
    const base = { workflow: 'CLIENT_APPROVAL', withholdingFiled: true } as const
    expect(decideTransition('REOPEN', { ...base, status: 'CLOSED', actor: 'CLIENT' })).toEqual({
      ok: false,
      reason: 'WITHHOLDING_FILED',
    })
    expect(decideTransition('REJECT', { ...base, status: 'PENDING_APPROVAL', actor: 'CLIENT' })).toEqual({
      ok: false,
      reason: 'WITHHOLDING_FILED',
    })
    expect(decideTransition('APPROVE', { ...base, status: 'PENDING_APPROVAL', actor: 'CLIENT' }).ok).toBe(true)
  })

  it('lists allowed actions by state and actor', () => {
    expect(
      allowedActions({ status: 'DRAFT', workflow: 'CLIENT_APPROVAL', actor: 'CLIENT', withholdingFiled: false }),
    ).toEqual(['SUBMIT', 'EDIT_ROWS', 'RECALCULATE', 'DELETE'])
    expect(
      allowedActions({ status: 'SUBMITTED', workflow: 'CLIENT_APPROVAL', actor: 'AGENCY', withholdingFiled: false }),
    ).toEqual(['RETURN_TO_DRAFT', 'REQUEST_APPROVAL', 'EDIT_ROWS', 'RECALCULATE'])
    expect(
      allowedActions({
        status: 'PENDING_APPROVAL',
        workflow: 'CLIENT_APPROVAL',
        actor: 'CLIENT',
        withholdingFiled: false,
      }),
    ).toEqual(['APPROVE', 'REJECT'])
  })

  it('maps states to the n/3 step', () => {
    expect([stepOf('DRAFT'), stepOf('SUBMITTED'), stepOf('PENDING_APPROVAL'), stepOf('CLOSED')]).toEqual([1, 2, 2, 3])
  })
})

describe('ledger dates', () => {
  it('derives payment dates and wage periods from the terms', () => {
    expect(defaultPaymentDate('2026-10', { paymentMonth: 'NEXT', paymentDay: 25 })).toBe('2026-11-25')
    expect(defaultPaymentDate('2026-02', { paymentMonth: 'SAME', paymentDay: 31 })).toBe('2026-02-28')
    expect(wagePeriodOf('2026-10', 1)).toEqual({ start: '2026-10-01', end: '2026-10-31' })
    expect(wagePeriodOf('2026-10', 16)).toEqual({ start: '2026-10-16', end: '2026-11-15' })
    expect(withholdingDeadlineOf('2026-12')).toBe('2027-01-10')
  })
})

describe('additional ledgers', () => {
  const regularSubmitted = { kind: 'REGULAR', attributionMonth: '2026-08', status: 'SUBMITTED' } as const
  const base = { attributionMonth: '2026-08', paymentDate: '2026-08-25', today: '2026-08-26', withholdingFiled: false }

  it('needs a submitted regular ledger and no draft ledger', () => {
    expect(additionalLedgerBlocker({ ...base, ledgers: [] })).toBe('NO_REGULAR_LEDGER')
    expect(additionalLedgerBlocker({ ...base, ledgers: [{ ...regularSubmitted, status: 'DRAFT' }] })).toBe(
      'REGULAR_LEDGER_NOT_SUBMITTED',
    )
    expect(
      additionalLedgerBlocker({
        ...base,
        ledgers: [regularSubmitted, { kind: 'REGULAR', attributionMonth: '2026-09', status: 'DRAFT' }],
      }),
    ).toBe('DRAFT_LEDGER_EXISTS')
    expect(additionalLedgerBlocker({ ...base, ledgers: [regularSubmitted] })).toBeNull()
  })

  it('stops after filing and five days before the withholding deadline', () => {
    expect(additionalLedgerBlocker({ ...base, ledgers: [regularSubmitted], withholdingFiled: true })).toBe(
      'WITHHOLDING_FILED',
    )
    expect(additionalLedgerBlocker({ ...base, ledgers: [regularSubmitted], today: '2026-09-04' })).toBeNull()
    expect(additionalLedgerBlocker({ ...base, ledgers: [regularSubmitted], today: '2026-09-05' })).toBe(
      'WITHHOLDING_DEADLINE_NEAR',
    )
  })

  it('finds a second wage row of the same employee and month', () => {
    const existing = [{ ledgerId: 'pyl_a', attributionMonth: '2026-08', employeeId: 'emp_a' }]
    expect(duplicatedWageIncome(existing, { attributionMonth: '2026-08', employeeId: 'emp_a' })).toBe('pyl_a')
    expect(duplicatedWageIncome(existing, { attributionMonth: '2026-09', employeeId: 'emp_a' })).toBeNull()
  })
})
