import { describe, expect, it } from 'vitest'
import type { TaxCalendarProfile } from './filing-calendar.types.ts'
import { resolveFilingObligations } from './filing-obligations.ts'

/** 픽스처에 없는 의무(중간예납, 간이과세자)입니다. `docs/design/rule-decisions/tax.md`의 filing-obligations 4. */

const corporation: TaxCalendarProfile = {
  businessType: 'CORPORATION',
  fiscalYearEndMonth: 12,
  withholdingCycle: 'MONTHLY',
  sincereFilingTarget: false,
  vatTaxpayerType: 'GENERAL',
  vatSupplyAmounts: {},
  vatPreliminaryElections: {},
}

const individual: TaxCalendarProfile = { ...corporation, businessType: 'INDIVIDUAL' }

function resolve(profile: TaxCalendarProfile, from: string, to: string) {
  return resolveFilingObligations({ profile, from, to, holidays: new Set() })
}

describe('중간예납', () => {
  it('12월 결산 법인은 1–6월분 법인세 중간예납을 8월 말일까지 신고합니다', () => {
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

  it('3월 결산 법인은 4–9월이 중간예납기간이고 기간 이름은 사업연도 종료 연도입니다', () => {
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

  it('개인의 종합소득세 중간예납은 11월 30일 고지로 징수합니다', () => {
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

  it('기한이 주말이면 다음 영업일로 미룹니다', () => {
    const notice = resolve(individual, '2025-11-01', '2025-12-31').find((item) => item.taxType === 'INCOME_TAX')
    expect(notice?.paymentDue).toBe('2025-12-01')
  })
})

describe('간이과세자 부가세', () => {
  const simplified: TaxCalendarProfile = { ...individual, vatTaxpayerType: 'SIMPLIFIED' }

  it('확정 신고는 1년 과세기간마다 다음 해 1월에 한 번이고 그 사이 7월에 예정부과 고지가 있습니다', () => {
    const vat = resolve(simplified, '2026-01-01', '2027-01-31').filter((item) => item.taxType === 'VAT')
    expect(vat.map((item) => [item.kind, item.periodKey, item.periodStart, item.periodEnd, item.paymentDue])).toEqual([
      ['FINAL', '2025', '2025-01-01', '2025-12-31', '2026-01-26'],
      ['NOTICE', '2026-H1', '2026-01-01', '2026-06-30', '2026-07-27'],
      ['FINAL', '2026', '2026-01-01', '2026-12-31', '2027-01-25'],
    ])
  })

  it('세금계산서를 발급했으면 고지 대신 예정 신고합니다', () => {
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

  it('법인은 일반과세자로 봅니다', () => {
    const general = resolve(corporation, '2026-01-01', '2026-12-31').filter((item) => item.taxType === 'VAT')
    const flagged = resolve({ ...corporation, vatTaxpayerType: 'SIMPLIFIED' }, '2026-01-01', '2026-12-31').filter(
      (item) => item.taxType === 'VAT',
    )
    expect(flagged).toEqual(general)
  })
})
