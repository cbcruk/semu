import { describe, expect, it } from 'vitest'
import { companyDate, companyMonth } from './company-date.ts'

describe('회사 날짜', () => {
  it('UTC가 아니라 회사 시간대로 날짜를 정합니다', () => {
    // UTC 2026-11-04 15:00은 서울 2026-11-05 00:00입니다.
    expect(companyDate(Date.UTC(2026, 10, 4, 15, 0))).toBe('2026-11-05')
    expect(companyDate(Date.UTC(2026, 10, 4, 14, 59))).toBe('2026-11-04')
  })
})

describe('회사 월', () => {
  it('서울 자정에 다음 달로 넘어갑니다', () => {
    expect(companyMonth(Date.UTC(2026, 9, 31, 15, 0))).toBe('2026-11')
    expect(companyMonth(Date.UTC(2026, 9, 31, 14, 59))).toBe('2026-10')
  })
})
