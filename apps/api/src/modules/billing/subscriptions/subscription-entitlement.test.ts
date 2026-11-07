import { describe, expect, it } from 'vitest'
import {
  allowedSubscriptionCommands,
  entitledPlans,
  isEntitledOn,
  refreshedStatus,
  subscriptionTransition,
} from './subscription-entitlement.ts'

const TODAY = '2026-11-05'

describe('날짜가 반영된 구독 상태', () => {
  it('대기 구독은 매일 작업을 기다리지 않고 시작일에 이용 중이 됩니다', () => {
    expect(refreshedStatus({ plan: 'PAYROLL', status: 'PENDING', startsOn: TODAY }, TODAY)).toBe('ACTIVE')
    expect(refreshedStatus({ plan: 'PAYROLL', status: 'PENDING', startsOn: '2026-11-06' }, TODAY)).toBe('PENDING')
  })

  it('구독은 종료일 다음 날 종료됩니다', () => {
    const term = { plan: 'TAXATION', status: 'CANCELLATION_SCHEDULED', startsOn: '2026-01-01' } as const

    expect(refreshedStatus({ ...term, endsOn: TODAY }, TODAY)).toBe('CANCELLATION_SCHEDULED')
    expect(refreshedStatus({ ...term, endsOn: '2026-11-04' }, TODAY)).toBe('ENDED')
  })

  it('기간 전체가 지난 대기 구독은 종료됩니다', () => {
    expect(
      refreshedStatus({ plan: 'TAXATION', status: 'PENDING', startsOn: '2026-01-01', endsOn: '2026-02-01' }, TODAY),
    ).toBe('ENDED')
  })
})

describe('이용 가능한 플랜', () => {
  it('플랜을 정해진 순서로 중복 없이 보여 줍니다', () => {
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

  it('종료된 구독은 원래 기간 안이라도 플랜을 주지 않습니다', () => {
    expect(
      isEntitledOn({ plan: 'TAXATION', status: 'ENDED', startsOn: '2026-01-01', endsOn: '2026-12-31' }, TODAY),
    ).toBe(false)
  })
})

describe('구독 상태 전이', () => {
  it('시작 전 해지는 바로 종료하고 이용 중 해지는 해지 예약합니다', () => {
    expect(subscriptionTransition('PENDING', 'CANCEL')).toBe('ENDED')
    expect(subscriptionTransition('ACTIVE', 'CANCEL')).toBe('CANCELLATION_SCHEDULED')
    expect(subscriptionTransition('CANCELLATION_SCHEDULED', 'RESUME')).toBe('ACTIVE')
    expect(subscriptionTransition('ENDED', 'CANCEL')).toBeUndefined()
  })

  it('상태가 허용하는 커맨드만 보여 줍니다', () => {
    expect(allowedSubscriptionCommands('ACTIVE')).toEqual(['CANCEL'])
    expect(allowedSubscriptionCommands('CANCELLATION_SCHEDULED')).toEqual(['RESUME'])
    expect(allowedSubscriptionCommands('ENDED')).toEqual([])
  })
})
