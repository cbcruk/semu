import { describe, expect, it } from 'vitest'
import { allowedPaymentActions, nextBusinessDay, plannedPayments, upcomingBillingMonth } from './payment-schedule.ts'

describe('다음 영업일', () => {
  it('평일은 그대로 두고 주말과 이어진 공휴일은 건너뜁니다', () => {
    expect(nextBusinessDay('2026-11-25', new Set())).toBe('2026-11-25')
    expect(nextBusinessDay('2026-10-03', new Set(['2026-10-05']))).toBe('2026-10-06')
  })
})

describe('다가오는 출금일의 달', () => {
  const christmas = new Set(['2026-12-25'])

  it('이번 달 출금일이 오늘보다 뒤면 이번 달, 출금일 당일부터는 다음 달입니다', () => {
    // 2026-12-25(공휴일)·26·27(주말)을 건너 출금일은 28일입니다.
    expect(upcomingBillingMonth('2026-12-01', christmas)).toBe('2026-12')
    expect(upcomingBillingMonth('2026-12-27', christmas)).toBe('2026-12')
    expect(upcomingBillingMonth('2026-12-28', christmas)).toBe('2027-01')
  })
})

describe('담당자가 할 수 있는 결제 커맨드', () => {
  it('실패한 결제는 재시도하고 완료된 결제는 환불할 수 있습니다', () => {
    expect(allowedPaymentActions('FAILED')).toEqual(['RETRY'])
    expect(allowedPaymentActions('PAID')).toEqual(['REFUND'])
    expect(allowedPaymentActions('SCHEDULED')).toEqual([])
  })
})

describe('그달 결제 예정', () => {
  const base = { subscriptionId: 'sub_1', plan: 'PAYROLL', monthlyFee: 330000, startsOn: '2026-01-01' } as const

  it('해지 예약한 구독은 종료일(그날 포함)까지 청구합니다', () => {
    const items = plannedPayments({
      month: '2026-11',
      subscriptions: [{ ...base, status: 'CANCELLATION_SCHEDULED', endsOn: '2026-11-30' }],
      existing: [],
      holidays: new Set(),
    })

    expect(items).toEqual([{ subscriptionId: 'sub_1', plan: 'PAYROLL', amount: 330000, scheduledOn: '2026-11-25' }])
  })

  it('출금일 전에 끝나거나 출금일 뒤에 시작하는 구독은 건너뜁니다', () => {
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
