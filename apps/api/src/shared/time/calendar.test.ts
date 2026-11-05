import { describe, expect, it } from 'vitest'
import { addDays, addMonths, daysBetween, lastDayOfMonth } from './calendar.ts'

describe('calendar', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('adds months across a year boundary', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })

  it('finds the last day of a month, leap years included', () => {
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29')
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28')
  })

  it('counts calendar days', () => {
    expect(daysBetween('2026-11-01', '2026-11-25')).toBe(24)
  })
})
