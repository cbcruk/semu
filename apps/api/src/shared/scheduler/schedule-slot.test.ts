import { describe, expect, it } from 'vitest'
import { latestSlot } from './schedule-slot.ts'

/** 회사 시간대(UTC+9) 시각을 epoch ms로 바꿉니다. */
const kst = (local: string) => Date.parse(`${local}+09:00`)

describe('latestSlot', () => {
  it('매일 작업은 오늘 시각이 지났으면 오늘, 아니면 어제 슬롯입니다', () => {
    const daily = { kind: 'DAILY', at: '03:00' } as const

    expect(latestSlot(daily, kst('2026-11-14T03:00:00'))).toEqual({
      key: '2026-11-14T03:00',
      at: kst('2026-11-14T03:00:00'),
    })
    expect(latestSlot(daily, kst('2026-11-14T02:59:59')).key).toBe('2026-11-13T03:00')
    // UTC로는 전날 18시지만 회사 시간대로는 다음 날 03시가 지났습니다.
    expect(latestSlot(daily, Date.parse('2026-11-14T18:30:00Z')).key).toBe('2026-11-15T03:00')
  })

  it('매월 작업은 그달 그날이 없으면 말일에 돌고, 아직이면 지난달 슬롯입니다', () => {
    const monthly = { kind: 'MONTHLY', day: 31, at: '06:00' } as const

    expect(latestSlot(monthly, kst('2027-02-28T06:00:00')).key).toBe('2027-02-28T06:00')
    expect(latestSlot(monthly, kst('2027-02-27T23:00:00')).key).toBe('2027-01-31T06:00')
    expect(latestSlot(monthly, kst('2027-01-15T00:00:00')).key).toBe('2026-12-31T06:00')
  })

  it('형식이 틀린 시각은 작업을 등록할 때 드러나도록 던집니다', () => {
    expect(() => latestSlot({ kind: 'DAILY', at: '24:00' }, 0)).toThrow('Invalid schedule time')
  })
})
