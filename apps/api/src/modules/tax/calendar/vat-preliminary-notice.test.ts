import { describe, expect, it } from 'vitest'
import type { TaxCalendarProfile } from './filing-calendar.types.ts'
import { resolveFilingObligations } from './filing-obligations.ts'
import { decideVatPreliminaryKind } from './vat-preliminary-notice.ts'

describe('부가세 예정고지 판정(decideVatPreliminaryKind)', () => {
  it('직전 과세기간 공급가액이 149,999,999원인 법인은 예정고지입니다', () => {
    expect(
      decideVatPreliminaryKind({ businessType: 'CORPORATION', priorPeriodSupplyAmount: 149_999_999, election: null }),
    ).toBe('NOTICE')
  })

  it('직전 과세기간 공급가액이 150,000,000원인 법인은 예정신고합니다', () => {
    expect(
      decideVatPreliminaryKind({ businessType: 'CORPORATION', priorPeriodSupplyAmount: 150_000_000, election: null }),
    ).toBe('PRELIMINARY')
  })

  it('직전 과세기간 공급가액을 모르거나 직전 과세기간이 없는 법인은 예정신고합니다', () => {
    expect(
      decideVatPreliminaryKind({ businessType: 'CORPORATION', priorPeriodSupplyAmount: null, election: null }),
    ).toBe('PRELIMINARY')
  })

  it('개인사업자는 공급가액과 상관없이 예정고지입니다', () => {
    for (const priorPeriodSupplyAmount of [null, 149_999_999, 150_000_000, 1_000_000_000]) {
      expect(decideVatPreliminaryKind({ businessType: 'INDIVIDUAL', priorPeriodSupplyAmount, election: null })).toBe(
        'NOTICE',
      )
    }
  })

  it('예정고지 대상도 휴업·사업 부진이나 조기환급으로 예정신고를 고르면 예정신고합니다', () => {
    for (const election of ['BUSINESS_DECLINE', 'EARLY_REFUND'] as const) {
      expect(decideVatPreliminaryKind({ businessType: 'INDIVIDUAL', priorPeriodSupplyAmount: null, election })).toBe(
        'PRELIMINARY',
      )
      expect(
        decideVatPreliminaryKind({ businessType: 'CORPORATION', priorPeriodSupplyAmount: 149_999_999, election }),
      ).toBe('PRELIMINARY')
    }
  })
})

describe('신고 일정의 부가세 예정 건', () => {
  const corporation: TaxCalendarProfile = {
    businessType: 'CORPORATION',
    fiscalYearEndMonth: 12,
    withholdingCycle: 'MONTHLY',
    sincereFilingTarget: false,
    vatTaxpayerType: 'GENERAL',
    vatSupplyAmounts: {},
    vatPreliminaryElections: {},
  }

  function vatOf(profile: TaxCalendarProfile) {
    return resolveFilingObligations({ profile, from: '2027-01-01', to: '2027-12-31', holidays: new Set() })
      .filter((obligation) => obligation.taxType === 'VAT')
      .map(({ kind, periodKey, periodStart, periodEnd }) => ({ kind, periodKey, periodStart, periodEnd }))
  }

  it('1기는 전년 2기, 2기는 같은 해 1기의 공급가액으로 기마다 정합니다', () => {
    const vat = vatOf({ ...corporation, vatSupplyAmounts: { '2026-H2': 149_999_999, '2027-H1': 150_000_000 } })

    expect(vat).toEqual([
      { kind: 'FINAL', periodKey: '2026-H2', periodStart: '2026-10-01', periodEnd: '2026-12-31' },
      { kind: 'NOTICE', periodKey: '2027-H1', periodStart: '2027-01-01', periodEnd: '2027-03-31' },
      { kind: 'FINAL', periodKey: '2027-H1', periodStart: '2027-01-01', periodEnd: '2027-06-30' },
      { kind: 'PRELIMINARY', periodKey: '2027-H2', periodStart: '2027-07-01', periodEnd: '2027-09-30' },
    ])
  })

  it('개인은 예정신고를 고른 과세기간만 예정 건이 신고입니다', () => {
    const vat = vatOf({
      ...corporation,
      businessType: 'INDIVIDUAL',
      vatPreliminaryElections: { '2027-H2': 'EARLY_REFUND' },
    })

    expect(vat.filter((obligation) => obligation.periodKey === '2027-H1').map((obligation) => obligation.kind)).toEqual(
      ['NOTICE', 'FINAL'],
    )
    expect(vat.find((obligation) => obligation.kind === 'PRELIMINARY')).toMatchObject({ periodKey: '2027-H2' })
  })
})
