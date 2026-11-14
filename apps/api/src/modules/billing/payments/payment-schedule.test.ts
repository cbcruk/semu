import { describe, expect, it } from 'vitest'
import {
  adjustScheduledPayment,
  allowedPaymentActions,
  nextBusinessDay,
  paymentTransition,
  plannedPayments,
  schedulingMonthOn,
  withdrawalsAwaitingResult,
} from './payment-schedule.ts'

describe('다음 영업일', () => {
  it('평일은 그대로 두고 주말과 이어진 공휴일은 건너뜁니다', () => {
    expect(nextBusinessDay('2026-11-25', new Set())).toBe('2026-11-25')
    expect(nextBusinessDay('2026-10-03', new Set(['2026-10-05']))).toBe('2026-10-06')
  })
})

describe('결제 예정을 만드는 달', () => {
  const christmas = new Set(['2026-12-25'])

  it('출금일 3일 전부터 전날까지만 그 달이고 그 밖의 날은 만들지 않습니다', () => {
    // 2026-12-25(공휴일)·26·27(주말)을 건너 출금일은 28일입니다.
    expect(schedulingMonthOn('2026-12-24', christmas)).toBeNull()
    expect(schedulingMonthOn('2026-12-25', christmas)).toBe('2026-12')
    expect(schedulingMonthOn('2026-12-27', christmas)).toBe('2026-12')
    expect(schedulingMonthOn('2026-12-28', christmas)).toBeNull()
    expect(schedulingMonthOn('2026-12-01', christmas)).toBeNull()
  })

  it('출금일이 다음 달로 넘어가도 지난달 출금일의 창을 봅니다', () => {
    // 2월 25일이 휴일로 이어져 출금일이 3월 2일이 되면 2월 27일부터 3월 1일까지가 2월분입니다.
    const holidays = new Set(['2027-02-25', '2027-02-26', '2027-03-01'])
    expect(schedulingMonthOn('2027-02-27', holidays)).toBe('2027-02')
    expect(schedulingMonthOn('2027-03-01', holidays)).toBe('2027-02')
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

describe('결제 예정 다시 맞추기', () => {
  const payment = { status: 'SCHEDULED' as const, scheduledOn: '2026-12-28', amount: 330000, mandateId: 'mdt_1' }
  const subscription = {
    subscriptionId: 'sub_1',
    plan: 'PAYROLL' as const,
    status: 'ACTIVE' as const,
    startsOn: '2026-01-01',
    monthlyFee: 330000,
  }
  const base = { payment, subscription, registeredMandateId: 'mdt_1', today: '2026-12-26' }

  it('구독·출금 동의가 그대로면 둡니다', () => {
    expect(adjustScheduledPayment(base)).toEqual({ kind: 'KEEP' })
  })

  it('해지 종료일이 출금일 전이거나 구독이 없으면 취소합니다', () => {
    const cancelling = { ...subscription, status: 'CANCELLATION_SCHEDULED' as const, endsOn: '2026-12-27' }
    expect(adjustScheduledPayment({ ...base, subscription: cancelling })).toEqual({ kind: 'CANCEL' })
    expect(adjustScheduledPayment({ ...base, subscription: undefined })).toEqual({ kind: 'CANCEL' })
  })

  it('종료일이 출금일이면 그날까지 이용하므로 둡니다', () => {
    const cancelling = { ...subscription, status: 'CANCELLATION_SCHEDULED' as const, endsOn: '2026-12-28' }
    expect(adjustScheduledPayment({ ...base, subscription: cancelling })).toEqual({ kind: 'KEEP' })
  })

  it('새로 등록한 출금 동의와 지금 월 이용료로 고칩니다', () => {
    expect(
      adjustScheduledPayment({
        ...base,
        subscription: { ...subscription, monthlyFee: 440000 },
        registeredMandateId: 'mdt_2',
      }),
    ).toEqual({ kind: 'UPDATE', amount: 440000, mandateId: 'mdt_2' })
  })

  it('출금일 당일이거나 이미 결과가 난 결제는 건드리지 않습니다', () => {
    expect(adjustScheduledPayment({ ...base, subscription: undefined, today: '2026-12-28' })).toEqual({ kind: 'KEEP' })
    expect(
      adjustScheduledPayment({ ...base, payment: { ...payment, status: 'FAILED' }, subscription: undefined }),
    ).toEqual({
      kind: 'KEEP',
    })
  })

  it('취소는 결제 예정에서만 되고 취소한 결제는 더 바뀌지 않습니다', () => {
    expect(paymentTransition('SCHEDULED', 'CANCEL')).toBe('CANCELED')
    expect(paymentTransition('FAILED', 'CANCEL')).toBeUndefined()
    expect(allowedPaymentActions('CANCELED')).toEqual([])
  })
})

describe('출금 결과를 기다리는 결제', () => {
  it('결과 반영일이 오늘이거나 지난 예정·재시도 결제를 출금일별로 묶습니다', () => {
    const rows = [
      { id: 'a', status: 'SCHEDULED' as const, scheduledOn: '2026-11-25' },
      { id: 'b', status: 'RETRYING' as const, scheduledOn: '2026-11-20' },
      { id: 'c', status: 'SCHEDULED' as const, scheduledOn: '2026-11-26' },
      { id: 'd', status: 'PAID' as const, scheduledOn: '2026-11-25' },
      { id: 'e', status: 'SCHEDULED' as const, scheduledOn: '2026-11-25' },
    ]

    expect(withdrawalsAwaitingResult(rows, '2026-11-26')).toEqual([
      { withdrawnOn: '2026-11-20', payments: [rows[1]] },
      { withdrawnOn: '2026-11-25', payments: [rows[0], rows[4]] },
    ])
  })
})
