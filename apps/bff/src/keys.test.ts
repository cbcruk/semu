import { describe, expect, it } from 'vitest'
import { camelCase, snakeCase, snakeCasePath, transformKeys } from './keys.ts'

describe('key casing', () => {
  it('converts between the legacy snake_case and the new camelCase', () => {
    expect(snakeCase('staySignedIn')).toBe('stay_signed_in')
    expect(camelCase('stay_signed_in')).toBe('staySignedIn')
    expect(camelCase(snakeCase('duplicateEmployeeId'))).toBe('duplicateEmployeeId')
    expect(snakeCasePath('rows[1].basePay')).toBe('rows[1].base_pay')
  })

  it('renames nested keys but copies the subtree under a legacy raw key as is', () => {
    const value = {
      payrollRow: { basePay: 1, other_deductions: { 'union_fee:A': 3, nestedKey: 4 } },
      items: [{ itemCode: 'X' }],
    }

    expect(transformKeys(value, snakeCase)).toEqual({
      payroll_row: { base_pay: 1, other_deductions: { 'union_fee:A': 3, nestedKey: 4 } },
      items: [{ item_code: 'X' }],
    })
  })

  it('leaves values, including strings that look like keys, untouched', () => {
    expect(transformKeys({ status: 'PRE_JOINED', list: ['someValue'] }, camelCase)).toEqual({
      status: 'PRE_JOINED',
      list: ['someValue'],
    })
  })
})
