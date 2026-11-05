import { describe, expect, it } from 'vitest'
import {
  allowedSubscriptionCommands,
  entitledPlans,
  isEntitledOn,
  refreshedStatus,
  subscriptionTransition,
} from './subscription-entitlement.ts'

const TODAY = '2026-11-05'

describe('refreshedStatus', () => {
  it('starts a pending subscription on its start date without waiting for a daily job', () => {
    expect(refreshedStatus({ plan: 'PAYROLL', status: 'PENDING', startsOn: TODAY }, TODAY)).toBe('ACTIVE')
    expect(refreshedStatus({ plan: 'PAYROLL', status: 'PENDING', startsOn: '2026-11-06' }, TODAY)).toBe('PENDING')
  })

  it('ends a subscription the day after its end date', () => {
    const term = { plan: 'TAXATION', status: 'CANCELLATION_SCHEDULED', startsOn: '2026-01-01' } as const

    expect(refreshedStatus({ ...term, endsOn: TODAY }, TODAY)).toBe('CANCELLATION_SCHEDULED')
    expect(refreshedStatus({ ...term, endsOn: '2026-11-04' }, TODAY)).toBe('ENDED')
  })

  it('ends a pending subscription whose whole window has passed', () => {
    expect(
      refreshedStatus({ plan: 'TAXATION', status: 'PENDING', startsOn: '2026-01-01', endsOn: '2026-02-01' }, TODAY),
    ).toBe('ENDED')
  })
})

describe('entitledPlans', () => {
  it('lists plans in a fixed order without duplicates', () => {
    const plans = entitledPlans(
      [
        { plan: 'PAYROLL', status: 'ACTIVE', startsOn: '2026-01-01' },
        { plan: 'TAXATION', status: 'ACTIVE', startsOn: '2026-01-01' },
        { plan: 'TAXATION', status: 'CANCELLATION_SCHEDULED', startsOn: '2025-01-01', endsOn: '2026-12-31' },
      ],
      TODAY,
    )

    expect(plans).toEqual(['TAXATION', 'PAYROLL'])
  })

  it('does not grant an ended subscription inside its old window', () => {
    expect(
      isEntitledOn({ plan: 'TAXATION', status: 'ENDED', startsOn: '2026-01-01', endsOn: '2026-12-31' }, TODAY),
    ).toBe(false)
  })
})

describe('subscriptionTransition', () => {
  it('ends a subscription canceled before it starts and schedules the end of an active one', () => {
    expect(subscriptionTransition('PENDING', 'CANCEL')).toBe('ENDED')
    expect(subscriptionTransition('ACTIVE', 'CANCEL')).toBe('CANCELLATION_SCHEDULED')
    expect(subscriptionTransition('CANCELLATION_SCHEDULED', 'RESUME')).toBe('ACTIVE')
    expect(subscriptionTransition('ENDED', 'CANCEL')).toBeUndefined()
  })

  it('offers only the commands the status allows', () => {
    expect(allowedSubscriptionCommands('ACTIVE')).toEqual(['CANCEL'])
    expect(allowedSubscriptionCommands('CANCELLATION_SCHEDULED')).toEqual(['RESUME'])
    expect(allowedSubscriptionCommands('ENDED')).toEqual([])
  })
})
