import { describe, expect, it } from 'vitest'
import { allowedActions, decideTransition, stepOf, transitionsOf } from './ledger-status.ts'
import {
  additionalLedgerBlocker,
  defaultPaymentDate,
  duplicatedWageIncome,
  wagePeriodOf,
  attributionMonthOn,
  withholdingDeadlineOf,
} from './ledger-rules.ts'

describe('급여대장 상태 전이', () => {
  it('급여 아웃소싱은 고객 승인 흐름을 따릅니다', () => {
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

  it('승인은 고객만, 승인 요청은 대리인만 할 수 있습니다', () => {
    const base = { workflow: 'CLIENT_APPROVAL', withholdingFiled: false } as const
    expect(decideTransition('APPROVE', { ...base, status: 'PENDING_APPROVAL', actor: 'AGENCY' }).ok).toBe(false)
    expect(decideTransition('REQUEST_APPROVAL', { ...base, status: 'SUBMITTED', actor: 'CLIENT' }).ok).toBe(false)
    expect(decideTransition('RETURN_TO_DRAFT', { ...base, status: 'SUBMITTED', actor: 'CLIENT' }).ok).toBe(false)
    expect(decideTransition('CLOSE', { ...base, status: 'SUBMITTED', actor: 'AGENCY' }).ok).toBe(false)
  })

  it('직접 운영은 승인 없이 바로 마감합니다', () => {
    const base = { workflow: 'DIRECT_CLOSE', withholdingFiled: false, actor: 'CLIENT' } as const
    expect(decideTransition('CLOSE', { ...base, status: 'DRAFT' })).toEqual({ ok: true, to: 'CLOSED' })
    expect(decideTransition('REQUEST_APPROVAL', { ...base, status: 'SUBMITTED' }).ok).toBe(false)
    expect(transitionsOf('DIRECT_CLOSE')).toEqual(['SUBMIT', 'RETURN_TO_DRAFT', 'CLOSE', 'REOPEN'])
  })

  it('원천세를 신고하면 금액이 바뀌는 전이를 잠급니다', () => {
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

  it('상태와 행위자에 따라 할 수 있는 동작을 알립니다', () => {
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

  it('상태를 정산 진행 n/3 단계로 바꿉니다', () => {
    expect([stepOf('DRAFT'), stepOf('SUBMITTED'), stepOf('PENDING_APPROVAL'), stepOf('CLOSED')]).toEqual([1, 2, 2, 3])
  })
})

describe('급여대장 날짜', () => {
  it('지급 조건에서 지급일과 임금산정 기간을 구합니다', () => {
    expect(defaultPaymentDate('2026-10', { paymentMonth: 'NEXT', paymentDay: 25 })).toBe('2026-11-25')
    expect(defaultPaymentDate('2026-02', { paymentMonth: 'SAME', paymentDay: 31 })).toBe('2026-02-28')
    expect(wagePeriodOf('2026-10', 1)).toEqual({ start: '2026-10-01', end: '2026-10-31' })
    expect(wagePeriodOf('2026-10', 16)).toEqual({ start: '2026-10-16', end: '2026-11-15' })
    expect(withholdingDeadlineOf('2026-12')).toBe('2027-01-10')
  })

  it('오늘이 든 임금산정 기간의 귀속월을 구합니다', () => {
    expect(attributionMonthOn('2026-11-01', 1)).toBe('2026-11')
    expect(attributionMonthOn('2026-11-15', 16)).toBe('2026-10')
    expect(attributionMonthOn('2026-11-16', 16)).toBe('2026-11')
    expect(attributionMonthOn('2027-01-05', 16)).toBe('2026-12')
    expect(attributionMonthOn('2026-02-28', 31)).toBe('2026-02')
    expect(attributionMonthOn('2026-03-30', 31)).toBe('2026-02')
  })
})

describe('추가 대장', () => {
  const regularSubmitted = { kind: 'REGULAR', attributionMonth: '2026-08', status: 'SUBMITTED' } as const
  const base = { attributionMonth: '2026-08', paymentDate: '2026-08-25', today: '2026-08-26', withholdingFiled: false }

  it('제출한 정기 대장이 있고 입력가능 대장이 없어야 만듭니다', () => {
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

  it('원천세를 신고했거나 신고 기한 5일 전부터는 만들지 못합니다', () => {
    expect(additionalLedgerBlocker({ ...base, ledgers: [regularSubmitted], withholdingFiled: true })).toBe(
      'WITHHOLDING_FILED',
    )
    expect(additionalLedgerBlocker({ ...base, ledgers: [regularSubmitted], today: '2026-09-04' })).toBeNull()
    expect(additionalLedgerBlocker({ ...base, ledgers: [regularSubmitted], today: '2026-09-05' })).toBe(
      'WITHHOLDING_DEADLINE_NEAR',
    )
  })

  it('같은 직원·귀속월의 두 번째 근로소득 행을 찾습니다', () => {
    const existing = [{ ledgerId: 'pyl_a', attributionMonth: '2026-08', employeeId: 'emp_a' }]
    expect(duplicatedWageIncome(existing, { attributionMonth: '2026-08', employeeId: 'emp_a' })).toBe('pyl_a')
    expect(duplicatedWageIncome(existing, { attributionMonth: '2026-09', employeeId: 'emp_a' })).toBeNull()
  })
})
