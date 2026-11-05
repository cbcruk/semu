import { describe, expect, it } from 'vitest'
import {
  birthDateFromRegistrationNumber,
  maskIdentityNumber,
  maskTail,
  normalizeIdentityNumber,
} from './identity-number.ts'

describe('normalizeIdentityNumber', () => {
  it('strips the hyphen of a registration number', () => {
    expect(normalizeIdentityNumber(' 900101-1234567 ', 'RRN')).toBe('9001011234567')
  })

  it('rejects an impossible birth date', () => {
    expect(normalizeIdentityNumber('901301-1234567', 'RRN')).toBeNull()
  })

  it('upper-cases a passport number', () => {
    expect(normalizeIdentityNumber('m1234567', 'PASSPORT')).toBe('M1234567')
  })
})

describe('birthDateFromRegistrationNumber', () => {
  it('reads the century from the seventh digit', () => {
    expect(birthDateFromRegistrationNumber('0501013123456')).toBe('2005-01-01')
    expect(birthDateFromRegistrationNumber('9001012123456')).toBe('1990-01-01')
  })
})

describe('masking', () => {
  it('keeps the birth date and gender digit', () => {
    expect(maskIdentityNumber('9001011234567', 'RRN')).toBe('900101-1******')
  })

  it('keeps the last digits of an account', () => {
    expect(maskTail('110123456789', 4)).toBe('********6789')
  })
})
