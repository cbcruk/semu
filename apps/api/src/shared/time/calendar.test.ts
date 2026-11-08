import { describe, expect, it } from 'vitest'
import { addDays, addMonths, daysBetween, lastDayOfMonth } from './calendar.ts'

describe('달력 계산', () => {
  it('월 경계를 넘어 일수를 더합니다', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('연 경계를 넘어 개월 수를 더합니다', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })

  it('윤년을 포함해 월의 마지막 날을 찾습니다', () => {
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29')
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28')
  })

  it('두 날짜 사이의 달력 일수를 셉니다', () => {
    expect(daysBetween('2026-11-01', '2026-11-25')).toBe(24)
  })
})
