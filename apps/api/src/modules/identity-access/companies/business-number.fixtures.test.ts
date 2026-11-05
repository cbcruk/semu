import { describe, expect, it } from 'vitest'
import { loadRuleCases } from '../rule-fixtures.ts'
import { isValidCorporateRegistrationNumber, normalizeBusinessNumber } from './business-number.ts'

/** 질문 4(바꿈): 2025-01-31 이후 법인등록번호에는 검증 숫자가 없어 자릿수만 봅니다. */
const CHANGED: Record<string, unknown> = {
  'corporate number with a wrong check digit': { valid: true },
}

describe('business-number-checksum fixtures', () => {
  const cases = loadRuleCases('business-number-checksum')

  it('names only existing cases as changed', () => {
    expect(Object.keys(CHANGED).filter((name) => !cases.some((testCase) => testCase.name === name))).toEqual([])
  })

  for (const testCase of cases) {
    const expected = Object.hasOwn(CHANGED, testCase.name) ? CHANGED[testCase.name] : testCase.expected
    it(testCase.name, () => {
      const value = testCase.input['value'] as string
      if (testCase.input['kind'] === 'business') {
        const normalized = normalizeBusinessNumber(value)
        expect(normalized === undefined ? { valid: false, message: 'bizNumber' } : { valid: true, normalized }).toEqual(
          expected,
        )
      } else {
        const valid = isValidCorporateRegistrationNumber(value)
        expect(valid ? { valid } : { valid, message: 'corpNumber' }).toEqual(expected)
      }
    })
  }
})
