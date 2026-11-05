import { describe, expect, it } from 'vitest'
import { allowedPaymentActions, nextBusinessDay, plannedPayments } from './payment-schedule.ts'

describe('nextBusinessDay', () => {
  it('keeps a weekday and skips a weekend followed by a holiday', () => {
    expect(nextBusinessDay('2026-11-25', new Set())).toBe('2026-11-25')
    expect(nextBusinessDay('2026-10-03', new Set(['2026-10-05']))).toBe('2026-10-06')
  })
})

describe('allowedPaymentActions', () => {
  it('lets the agency retry a failed payment and refund a paid one', () => {
    expect(allowedPaymentActions('FAILED')).toEqual(['RETRY'])
    expect(allowedPaymentActions('PAID')).toEqual(['REFUND'])
    expect(allowedPaymentActions('SCHEDULED')).toEqual([])
  })
})

describe('plannedPayments', () => {
  const base = { subscriptionId: 'sub_1', plan: 'PAYROLL', monthlyFee: 330000, startsOn: '2026-01-01' } as const

  it('bills a subscription canceled for later until its end date', () => {
    const items = plannedPayments({
      month: '2026-11',
      subscriptions: [{ ...base, status: 'CANCELLATION_SCHEDULED', endsOn: '2026-11-30' }],
      existing: [],
      holidays: new Set(),
    })

    expect(items).toEqual([{ subscriptionId: 'sub_1', plan: 'PAYROLL', amount: 330000, scheduledOn: '2026-11-25' }])
  })

  it('skips a subscription that ends before the billing day or starts after it', () => {
    const items = plannedPayments({
      month: '2026-11',
      subscriptions: [
        { ...base, status: 'CANCELLATION_SCHEDULED', endsOn: '2026-11-20' },
        { ...base, subscriptionId: 'sub_2', status: 'PENDING', startsOn: '2026-11-26' },
      ],
      existing: [],
      holidays: new Set(),
    })

    expect(items).toEqual([])
  })
})
