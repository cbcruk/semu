import { describe, expect, it } from 'vitest'
import { isId, newId } from './ids.ts'

describe('newId', () => {
  it('prefixes the ULID with the entity kind', () => {
    expect(newId('employee')).toMatch(/^emp_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('sorts by creation time', () => {
    expect(newId('filing', 1_000) < newId('filing', 2_000)).toBe(true)
  })
})

describe('isId', () => {
  it('accepts an id of the same kind', () => {
    expect(isId('filing', newId('filing'))).toBe(true)
  })

  it('rejects an id of another kind', () => {
    expect(isId('filing', newId('employee'))).toBe(false)
  })

  it('rejects malformed values', () => {
    expect(isId('filing', 'fil_123')).toBe(false)
    expect(isId('filing', 42)).toBe(false)
  })
})
