import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromLegacyPeriodKey, LEGACY_FILING_STATUS, LEGACY_TAX_TYPE } from '../legacy-names.ts'
import type { FilingObligation, TaxCalendarProfile } from './filing-calendar.types.ts'
import { rollForwardDeadline } from './filing-deadline.ts'
import { resolveFilingObligations } from './filing-obligations.ts'
import { planSchedule } from './filing-schedule.ts'

/**
 * 현행 구현 픽스처(`filing-deadline-rollover.json`, `filing-obligations.json`)를 서버 규칙으로 옮긴 테스트입니다.
 *
 * 현행 `tax_period_key`는 세목·종류·기간 이름으로 바꿔 찾고, 현행 응답의 `quarter`는 비교하지 않습니다
 * (`docs/design/rule-decisions/tax.md`의 filing-obligations 1).
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: Record<string, any>
}

function load(rule: string): FixtureCase[] {
  const path = join(import.meta.dirname, `../../../../test/fixtures/rules/${rule}.json`)
  return (JSON.parse(readFileSync(path, 'utf8')) as { cases: FixtureCase[] }).cases
}

const rollover = load('filing-deadline-rollover')
const obligations = load('filing-obligations')

/**
 * 현행 `vatPreliminaryMode`를 과세기간별 공급가액으로 옮깁니다. 고지 모드 법인은 계산하는 모든 과세기간의 공급가액을
 * 1억 5천만 원 미만으로, 신고 모드 법인은 공급가액 없음(예정신고)으로 둡니다. 개인은 모드와 상관없이 예정고지입니다.
 */
function vatSupplyAmountsOf(company: Record<string, any>, from: string, to: string): Record<string, number> {
  if (company['vatPreliminaryMode'] === 'filing') return {}
  const years = Array.from({ length: Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 4 }, (_, index) => {
    return Number(from.slice(0, 4)) - 2 + index
  })
  return Object.fromEntries(years.flatMap((year) => [`${year}-H1`, `${year}-H2`].map((key) => [key, 100_000_000])))
}

function profileOf(company: Record<string, any>, from: string, to: string): TaxCalendarProfile {
  return {
    businessType: company['businessType'] === 'corporate' ? 'CORPORATION' : 'INDIVIDUAL',
    fiscalYearEndMonth: company['fiscalYearEndMonth'],
    withholdingCycle: company['withholdingSemiannual'] === true ? 'SEMIANNUAL' : 'MONTHLY',
    sincereFilingTarget: company['sincereFilingTarget'],
    vatTaxpayerType: 'GENERAL',
    vatSupplyAmounts: vatSupplyAmountsOf(company, from, to),
    vatPreliminaryElections: {},
  }
}

function resolve(input: Record<string, any>): FilingObligation[] {
  return resolveFilingObligations({
    profile: profileOf(input['company'], input['from'], input['to']),
    from: input['from'],
    to: input['to'],
    holidays: new Set(input['holidays']),
  })
}

/** 현행 키 접두사로 세목을 정합니다. 픽스처 케이스는 키마다 세목이 하나뿐입니다. */
function legacyTaxTypeOf(key: string, expectedTaxType?: string): string {
  if (expectedTaxType !== undefined) return expectedTaxType
  if (/-(preliminary|final|notice)$/.test(key)) return 'surtax'
  if (/-(payment|semiannual)$/.test(key)) return 'withholding_tax'
  return key.endsWith('-FY') ? 'corporation_tax' : 'aggr_income_tax'
}

function legacyKeyOf(obligation: FilingObligation): string {
  const year = obligation.periodKey.slice(0, 4)
  switch (obligation.kind) {
    case 'PRELIMINARY':
    case 'FINAL':
    case 'NOTICE':
      return `${year}-${obligation.periodKey.slice(-1)}-${obligation.kind.toLowerCase()}`
    case 'MONTHLY':
      return `${obligation.periodKey}-payment`
    case 'SEMIANNUAL':
      return `${obligation.periodKey}-semiannual`
    case 'INTERIM':
      return `${year}-interim`
    case 'ANNUAL':
      return obligation.taxType === 'CORPORATE_TAX' ? `${year}-FY` : `${year}-annual`
  }
}

function cases(check: string): FixtureCase[] {
  return obligations.filter((testCase) => testCase.input['check'] === check)
}

describe('신고 기한 이월 픽스처(filing-deadline-rollover)', () => {
  it.each(rollover.map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    expect(rollForwardDeadline(input['statutoryDue'], new Set(input['holidays']))).toBe(expected['deadline'])
  })
})

describe('신고 의무 픽스처(filing-obligations)', () => {
  it.each(cases('period').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const key = fromLegacyPeriodKey(legacyTaxTypeOf(input['taxPeriodKey'], expected['taxType']), input['taxPeriodKey'])
    const found = resolve(input).find(
      (obligation) =>
        obligation.taxType === key.taxType && obligation.kind === key.kind && obligation.periodKey === key.periodKey,
    )

    if (expected['found'] === false) {
      expect(found).toBeUndefined()
      return
    }
    expect(found).toEqual({
      taxType: LEGACY_TAX_TYPE[expected['taxType']],
      kind: key.kind,
      periodKey: key.periodKey,
      periodStart: expected['periodStart'],
      periodEnd: expected['periodEnd'],
      statutoryDue: expected['statutoryDue'],
      dueDate: expected['dueDate'],
      paymentDue: expected['paymentDue'],
    })
  })

  it.each(cases('window').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    expect(resolve(input).map(legacyKeyOf)).toEqual(expected['taxPeriodKeys'])
  })

  it.each(cases('schedule').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const toObligation = (period: Record<string, any>): FilingObligation => ({
      ...fromLegacyPeriodKey(period['taxType'], period['taxPeriodKey']),
      periodStart: '',
      periodEnd: '',
      statutoryDue: period['dueDate'],
      dueDate: period['dueDate'],
      paymentDue: period['paymentDue'],
    })
    const existing = (input['existing'] as Record<string, any>[]).map((filing) => ({
      ...fromLegacyPeriodKey(filing['taxType'], filing['taxPeriodKey']),
      id: filing['id'],
      status: LEGACY_FILING_STATUS[filing['status']]!,
      dueDate: filing['dueDate'],
      paymentDue: filing['paymentDue'],
    }))
    const plan = planSchedule((input['periods'] as Record<string, any>[]).map(toObligation), existing, input['window'])

    expect({
      created: plan.create.map(
        (obligation) => `${legacyTaxTypeOf(legacyKeyOf(obligation))}:${legacyKeyOf(obligation)}`,
      ),
      updated: plan.refresh.map((item) => item.filingId),
      cancelled: plan.cancel,
    }).toEqual(expected)
  })

  it('픽스처의 사례를 모두 옮겼습니다', () => {
    expect(cases('period').length + cases('window').length + cases('schedule').length).toBe(obligations.length)
  })
})
