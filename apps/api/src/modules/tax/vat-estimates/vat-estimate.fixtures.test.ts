import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addMonths, lastDayOfMonth } from '../../../shared/time/calendar.ts'
import { LEGACY_FILING_KIND, LEGACY_FILING_STATUS } from '../legacy-names.ts'
import { estimateVat, salesVatOf, vatEstimatePeriod, vatTrend } from './vat-estimate.ts'
import type { PurchaseEvidence, SalesEvidence, VatFilingFact } from './vat-estimate.types.ts'

/**
 * 현행 구현 픽스처(`test/fixtures/rules/estimated-vat.json`)를 서버 규칙으로 옮긴 테스트입니다.
 *
 * 카드 과세 비율은 bp를 ppm으로(×100), 출처·기간 단위는 대문자 enum으로 바꿉니다. 현행 `is_refund`는 응답에서 뺐으므로
 * `estimatedTax < 0`과 같은지로 검사합니다 (`docs/design/rule-decisions/tax.md`의 estimated-vat 3, 6).
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: Record<string, any>
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/estimated-vat.json'), 'utf8'),
) as { cases: FixtureCase[] }

const BP_TO_PPM = 100

function cases(check: string): FixtureCase[] {
  return fixture.cases.filter((testCase) => testCase.input['check'] === check)
}

function salesOf(rows: Record<string, any>[]): SalesEvidence[] {
  return rows.map((row) => ({
    id: row['id'],
    source: row['source'].toUpperCase(),
    issuedOn: row['issued_on'],
    totalAmount: row['total_amount'],
    vatAmount: row['vat_amount'],
    dedupeGroup: row['dedupe_group'],
    syncedAt: '2026-11-01T04:00:00+09:00',
  }))
}

function purchasesOf(rows: Record<string, any>[]): PurchaseEvidence[] {
  return rows.map((row) => ({
    id: row['id'],
    source: row['source'].toUpperCase(),
    issuedOn: row['issued_on'],
    vatAmount: row['vat_amount'],
    deductible: row['deductible'] === null ? null : row['deductible'] === 1,
    syncedAt: '2026-11-01T04:00:00+09:00',
  }))
}

/** 현행 신고 건의 연·분기를 기간으로 바꿉니다. 확정 신고의 기간 끝은 반기 끝입니다. */
function filingOf(row: Record<string, any>): VatFilingFact {
  const firstMonth = `${row['year']}-${String(row['quarter'] * 3 - 2).padStart(2, '0')}`
  return {
    kind: LEGACY_FILING_KIND[row['kind']]!,
    status: LEGACY_FILING_STATUS[row['status']]!,
    periodStart: `${firstMonth}-01`,
    periodEnd: lastDayOfMonth(addMonths(firstMonth, 2)),
    payableAmount: row['payable_amount'],
  }
}

describe('estimated-vat fixture', () => {
  it.each(cases('period').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const period = vatEstimatePeriod(input['businessType'] === 'corporate' ? 'CORPORATION' : 'INDIVIDUAL', input['on'])

    expect(period).toEqual({ ...expected, unit: expected['unit'].toUpperCase() })
  })

  it.each(cases('sales-vat').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const [row] = salesOf([
      {
        id: 's',
        source: 'card',
        issued_on: '2026-10-01',
        total_amount: input['totalAmount'],
        vat_amount: input['vatAmount'],
      },
    ])

    expect(salesVatOf({ ...row!, dedupeGroup: null }, input['taxableCardRatioBp'] * BP_TO_PPM)).toBe(expected['vat'])
  })

  it.each(cases('estimate').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const estimate = estimateVat({
      period: { ...input['period'], unit: input['period']['unit'].toUpperCase() },
      sales: salesOf(input['sales']),
      purchases: purchasesOf(input['purchases']),
      taxableCardRatioPpm: input['taxableCardRatioBp'] * BP_TO_PPM,
    })

    expect({
      output_tax: estimate.outputTax,
      input_tax: estimate.inputTax,
      estimated_tax: estimate.estimatedTax,
      is_refund: estimate.estimatedTax < 0,
      card_split_estimated: estimate.cardSplitEstimated,
      breakdown: estimate.breakdown.map((entry) => ({
        side: entry.side.toLowerCase(),
        source: entry.source.toLowerCase(),
        vat_amount: entry.vatAmount,
        included_in_total: entry.includedInTotal,
      })),
      excluded: {
        non_deductible_count: estimate.excluded.nonDeductibleCount,
        unclassified_count: estimate.excluded.unclassifiedCount,
      },
    }).toEqual(expected)
  })

  it.each(cases('trend').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const estimates = input['estimates'] as Record<string, number>
    const points = vatTrend({
      today: input['today'],
      years: input['years'],
      hasTaxationPlan: input['taxPlan'] === 'taxation',
      filings: (input['filings'] as Record<string, any>[]).map(filingOf),
      estimate: (period) => estimates[`${period.start}..${period.end}`]!,
    })

    expect(points).toEqual(
      (expected['points'] as Record<string, any>[]).map((point) => ({
        ...point,
        source: point['source'].toUpperCase(),
      })),
    )
  })

  it('ports every case', () => {
    const checks = ['period', 'sales-vat', 'estimate', 'trend']

    expect(checks.reduce((sum, check) => sum + cases(check).length, 0)).toBe(fixture.cases.length)
  })
})
