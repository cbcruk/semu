import { describe, expect, it } from 'vitest'
import { loadRuleCases } from '../rule-fixtures.ts'
import { isValidCorporateRegistrationNumber, normalizeBusinessNumber } from './business-number.ts'

describe('business-number-checksum fixtures', () => {
  for (const testCase of loadRuleCases('business-number-checksum')) {
    it(testCase.name, () => {
      const value = testCase.input['value'] as string
      if (testCase.input['kind'] === 'business') {
        const normalized = normalizeBusinessNumber(value)
        expect(normalized === undefined ? { valid: false, message: 'bizNumber' } : { valid: true, normalized }).toEqual(
          testCase.expected,
        )
      } else {
        const valid = isValidCorporateRegistrationNumber(value)
        expect(valid ? { valid } : { valid, message: 'corpNumber' }).toEqual(testCase.expected)
      }
    })
  }
})
