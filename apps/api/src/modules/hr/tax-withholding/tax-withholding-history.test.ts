import { describe, expect, it } from 'vitest'
import { entryInEffect, upsertEntry } from './tax-withholding-history.ts'

const january = { effectiveFrom: '2026-01-01', value: 1 }
const july = { effectiveFrom: '2026-07-01', value: 2 }

describe('entryInEffect', () => {
  it('picks the latest entry effective on the date', () => {
    expect(entryInEffect([january, july], '2026-06-30')).toBe(january)
    expect(entryInEffect([january, july], '2026-07-01')).toBe(july)
  })

  it('has nothing before the first entry', () => {
    expect(entryInEffect([january, july], '2025-12-31')).toBeUndefined()
  })
})

describe('upsertEntry', () => {
  it('replaces the entry with the same date and keeps date order', () => {
    const replaced = { effectiveFrom: '2026-01-01', value: 3 }

    expect(upsertEntry([july, january], replaced)).toEqual([replaced, july])
  })
})
