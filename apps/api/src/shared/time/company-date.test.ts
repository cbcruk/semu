import { describe, expect, it } from 'vitest'
import { companyDate, companyMonth } from './company-date.ts'

describe('companyDate', () => {
  it('uses the company time zone, not UTC', () => {
    // UTC 2026-11-04 15:00은 서울 2026-11-05 00:00입니다.
    expect(companyDate(Date.UTC(2026, 10, 4, 15, 0))).toBe('2026-11-05')
    expect(companyDate(Date.UTC(2026, 10, 4, 14, 59))).toBe('2026-11-04')
  })
})

describe('companyMonth', () => {
  it('rolls over to the next month at Seoul midnight', () => {
    expect(companyMonth(Date.UTC(2026, 9, 31, 15, 0))).toBe('2026-11')
    expect(companyMonth(Date.UTC(2026, 9, 31, 14, 59))).toBe('2026-10')
  })
})
