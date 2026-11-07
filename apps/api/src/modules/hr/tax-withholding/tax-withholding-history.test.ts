import { describe, expect, it } from 'vitest'
import { entryInEffect, upsertEntry } from './tax-withholding-history.ts'

const january = { effectiveFrom: '2026-01-01', value: 1 }
const july = { effectiveFrom: '2026-07-01', value: 2 }

describe('적용 중인 이력 항목', () => {
  it('그날(포함)까지 적용 시작한 항목 중 가장 늦은 항목입니다', () => {
    expect(entryInEffect([january, july], '2026-06-30')).toBe(january)
    expect(entryInEffect([january, july], '2026-07-01')).toBe(july)
  })

  it('첫 항목 전에는 적용 항목이 없습니다', () => {
    expect(entryInEffect([january, july], '2025-12-31')).toBeUndefined()
  })
})

describe('이력 항목 넣기', () => {
  it('같은 적용 시작일의 항목은 바꾸고 날짜 순서를 지킵니다', () => {
    const replaced = { effectiveFrom: '2026-01-01', value: 3 }

    expect(upsertEntry([july, january], replaced)).toEqual([replaced, july])
  })
})
