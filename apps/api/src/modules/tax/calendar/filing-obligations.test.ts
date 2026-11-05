import { describe, expect, it } from 'vitest'
import type { TaxCalendarProfile } from './filing-calendar.types.ts'
import { resolveFilingObligations } from './filing-obligations.ts'

/** 픽스처에 없는 의무(중간예납, 간이과세자)입니다. `docs/design/rule-decisions/tax.md`의 filing-obligations 4. */

const corporation: TaxCalendarProfile = {
  businessType: 'CORPORATION',
  fiscalYearEndMonth: 12,
  withholdingCycle: 'MONTHLY',
  vatPreliminaryMode: 'FILING',
  sincereFilingTarget: false,
  vatTaxpayerType: 'GENERAL',
}

const individual: TaxCalendarProfile = { ...corporation, businessType: 'INDIVIDUAL', vatPreliminaryMode: 'NOTICE' }

function resolve(profile: TaxCalendarProfile, from: string, to: string) {
  return resolveFilingObligations({ profile, from, to, holidays: new Set() })
}

describe('interim prepayment', () => {
  it('files corporate tax for the first six months by the end of August', () => {
    const interim = resolve(corporation, '2026-01-01', '2026-12-31').find((item) => item.kind === 'INTERIM')
    expect(interim).toEqual({
      taxType: 'CORPORATE_TAX',
      kind: 'INTERIM',
      periodKey: '2026',
      periodStart: '2026-01-01',
      periodEnd: '2026-06-30',
      statutoryDue: '2026-08-31',
      dueDate: '2026-08-31',
      paymentDue: '2026-08-31',
    })
  })

  it('follows a March fiscal year end', () => {
    const interim = resolve({ ...corporation, fiscalYearEndMonth: 3 }, '2026-01-01', '2026-12-31').find(
      (item) => item.kind === 'INTERIM',
    )
    expect(interim).toMatchObject({
      periodKey: '2027',
      periodStart: '2026-04-01',
      periodEnd: '2026-09-30',
      statutoryDue: '2026-11-30',
    })
  })

  it('collects individual income tax by notice on November 30', () => {
    const notice = resolve(individual, '2026-11-01', '2026-11-30').find((item) => item.taxType === 'INCOME_TAX')
    expect(notice).toEqual({
      taxType: 'INCOME_TAX',
      kind: 'NOTICE',
      periodKey: '2026-H1',
      periodStart: '2026-01-01',
      periodEnd: '2026-06-30',
      statutoryDue: null,
      dueDate: null,
      paymentDue: '2026-11-30',
    })
  })

  it('rolls a weekend deadline forward', () => {
    const notice = resolve(individual, '2025-11-01', '2025-12-31').find((item) => item.taxType === 'INCOME_TAX')
    expect(notice?.paymentDue).toBe('2025-12-01')
  })
})

describe('simplified VAT taxpayer', () => {
  const simplified: TaxCalendarProfile = { ...individual, vatTaxpayerType: 'SIMPLIFIED' }

  it('has a July notice and one annual return', () => {
    const vat = resolve(simplified, '2026-01-01', '2027-01-31').filter((item) => item.taxType === 'VAT')
    expect(vat.map((item) => [item.kind, item.periodKey, item.periodStart, item.periodEnd, item.paymentDue])).toEqual([
      ['FINAL', '2025', '2025-01-01', '2025-12-31', '2026-01-26'],
      ['NOTICE', '2026-H1', '2026-01-01', '2026-06-30', '2026-07-27'],
      ['FINAL', '2026', '2026-01-01', '2026-12-31', '2027-01-25'],
    ])
  })

  it('files a preliminary return instead of a notice after issuing tax invoices', () => {
    const issuer = { ...simplified, vatSimplifiedInvoiceIssuer: true }
    const preliminary = resolve(issuer, '2026-07-01', '2026-07-31').find((item) => item.taxType === 'VAT')
    expect(preliminary).toEqual({
      taxType: 'VAT',
      kind: 'PRELIMINARY',
      periodKey: '2026-H1',
      periodStart: '2026-01-01',
      periodEnd: '2026-06-30',
      statutoryDue: '2026-07-25',
      dueDate: '2026-07-27',
      paymentDue: '2026-07-27',
    })
  })

  it('treats a corporation as a general taxpayer', () => {
    const general = resolve(corporation, '2026-01-01', '2026-12-31').filter((item) => item.taxType === 'VAT')
    const flagged = resolve({ ...corporation, vatTaxpayerType: 'SIMPLIFIED' }, '2026-01-01', '2026-12-31').filter(
      (item) => item.taxType === 'VAT',
    )
    expect(flagged).toEqual(general)
  })
})
