import { describe, expect, it } from 'vitest'
import { isId, newId } from './ids.ts'

describe('식별자 만들기(newId)', () => {
  it('ULID 앞에 엔터티 종류 접두어를 붙입니다', () => {
    expect(newId('employee')).toMatch(/^emp_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('만든 시각 순서대로 정렬됩니다', () => {
    expect(newId('filing', 1_000) < newId('filing', 2_000)).toBe(true)
  })
})

describe('식별자 판정(isId)', () => {
  it('같은 종류의 식별자는 받아들입니다', () => {
    expect(isId('filing', newId('filing'))).toBe(true)
  })

  it('다른 종류의 식별자는 거부합니다', () => {
    expect(isId('filing', newId('employee'))).toBe(false)
  })

  it('형식이 잘못된 값은 거부합니다', () => {
    expect(isId('filing', 'fil_123')).toBe(false)
    expect(isId('filing', 42)).toBe(false)
  })
})
