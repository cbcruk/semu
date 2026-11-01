import { describe, expect, it } from 'vitest'
import { applyBasisPoints, splitVatFromTotal } from '../src/lib/money'
import { sniffMimeType } from '../src/lib/file-storage/sniff-mime'
import { decide } from '../src/modules/access/access'
import type { AccessContext } from '../src/modules/access/access.types'
import { TRANSITIONS } from '../src/modules/filings/filing-status'
import type { FilingStatus } from '../src/modules/filings/filings.types'
import { processStepOf } from '../src/modules/filings/process-step'

describe('money', () => {
  it.each([11_000, 10_000, 1, 999_999_999, 12_345_678])('mirrors cancellations exactly for %i', (total) => {
    expect(splitVatFromTotal(-total)).toBe(-splitVatFromTotal(total))
  })

  it('splits VAT-inclusive totals', () => {
    expect(splitVatFromTotal(11_000)).toBe(1_000)
    expect(splitVatFromTotal(10_000)).toBe(910)
    expect(splitVatFromTotal(0)).toBe(0)
  })

  it('truncates basis point scaling toward zero', () => {
    expect(applyBasisPoints(999, 5_000)).toBe(499)
    expect(applyBasisPoints(-999, 5_000)).toBe(-499)
  })

  it('rejects fractional won', () => {
    expect(() => splitVatFromTotal(1.5)).toThrow(RangeError)
  })
})

describe('decide', () => {
  const base: AccessContext = {
    userId: 'u',
    isAdmin: false,
    roleMenuCodes: new Set(['tax_surtax']),
    businessType: 'corporate',
    taxPlan: 'taxation',
    hasPayrollPlan: false,
    taxTermsAgreed: true,
  }

  it.each<[string, Partial<AccessContext>, string, string | true]>([
    ['allows a permitted member', {}, 'tax_surtax', true],
    ['hides other tax menus without permission', {}, 'tax_withholding', 'PERMISSION_DENIED'],
    ['lets admins open every menu', { isAdmin: true, roleMenuCodes: new Set() }, 'tax_withholding', true],
    ['hides income tax from corporations', { isAdmin: true }, 'tax_aggr_income', 'NOT_FOUND'],
    ['checks permission before plan', { taxPlan: null, roleMenuCodes: new Set() }, 'tax_surtax', 'PERMISSION_DENIED'],
    ['upsells free companies', { taxPlan: null }, 'tax_surtax', 'ENTITLEMENT_REQUIRED'],
    ['requires tax terms', { taxTermsAgreed: false }, 'tax_surtax', 'TAX_TERMS_REQUIRED'],
    ['opens today without permission', { roleMenuCodes: new Set() }, 'today', true],
    ['keeps estimated VAT free of plans', { taxPlan: null, roleMenuCodes: new Set(['estimated_vat']) }, 'estimated_vat', true],
  ])('%s', (_name, overrides, code, expected) => {
    const decision = decide({ ...base, ...overrides }, code as Parameters<typeof decide>[1])
    expect(decision.ok ? true : decision.reason).toBe(expected)
  })
})

describe('state machine', () => {
  it('maps every reachable status to a legacy step', () => {
    const reachable = new Set<FilingStatus>(Object.values(TRANSITIONS).map((rule) => rule.to))
    for (const status of reachable) {
      if (status === 'cancelled') continue
      expect(processStepOf('surtax', status).step).not.toBeNull()
    }
  })

  it('uses the legacy VAT step labels', () => {
    expect(processStepOf('surtax', 'ledger_pending')).toEqual({ step: '매입매출장 확인', index: 3, count: 6 })
    expect(processStepOf('withholding_tax', 'preparing')).toEqual({ step: '작업중', index: 3, count: 5 })
    expect(processStepOf('surtax', 'scheduled').step).toBeNull()
  })
})

describe('sniffMimeType', () => {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

  it('detects by content, not name', () => {
    expect(sniffMimeType(encode('%PDF-1.4 ...'), 'statement.png')).toBe('application/pdf')
    expect(sniffMimeType(encode('MZ executable'), 'statement.pdf')).toBeNull()
  })

  it('accepts XLSX but not plain ZIP archives', () => {
    const zipHeader = [0x50, 0x4b, 0x03, 0x04]
    const xlsx = new Uint8Array([...zipHeader, ...encode('....[Content_Types].xml')])
    expect(sniffMimeType(xlsx, 'ledger.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(sniffMimeType(xlsx, 'ledger.zip')).toBeNull()
    expect(sniffMimeType(new Uint8Array([...zipHeader, 1, 2, 3]), 'ledger.xlsx')).toBeNull()
  })

  it('accepts UTF-8 CSV only', () => {
    expect(sniffMimeType(encode('date,amount\n2026-10-01,1000'), 'list.csv')).toBe('text/csv')
    expect(sniffMimeType(new Uint8Array([0xff, 0xfe, 0x00]), 'list.csv')).toBeNull()
  })
})
