import { describe, expect, it } from 'vitest'
import { addMonths, isPlainDate, toPlainDate } from '../src/lib/plain-date'
import type { PlainDate } from '../src/lib/plain-date.types'
import { resolveFilingPeriods } from '../src/modules/tax-calendar/tax-calendar'
import type { CalendarCompany } from '../src/modules/tax-calendar/tax-calendar.types'
import { applyDeadlineRollover } from '../src/modules/tax-calendar/tax-calendar.utils'

const d = (value: string): PlainDate => toPlainDate(value)

const corporate: CalendarCompany = {
  businessType: 'corporate',
  fiscalYearEndMonth: 12,
  withholdingSemiannual: false,
  vatPreliminaryMode: 'filing',
  sincereFilingTarget: false,
}
const individual: CalendarCompany = { ...corporate, businessType: 'individual', vatPreliminaryMode: 'notice' }

function find(company: CalendarCompany, taxPeriodKey: string, from = '2026-01-01', to = '2027-12-31'): ReturnType<typeof resolveFilingPeriods>[number] {
  const period = resolveFilingPeriods({ company, from: d(from), to: d(to), holidays: new Set() }).find((p) => p.taxPeriodKey === taxPeriodKey)
  if (period === undefined) throw new Error(`missing ${taxPeriodKey}`)
  return period
}

describe('plain dates', () => {
  it('rejects impossible dates', () => {
    expect(isPlainDate('2026-02-29')).toBe(false)
    expect(isPlainDate('2028-02-29')).toBe(true)
    expect(isPlainDate('2026-13-01')).toBe(false)
  })

  it('clamps month arithmetic to the end of the month', () => {
    expect(addMonths(d('2026-01-31'), 1)).toBe('2026-02-28')
    expect(addMonths(d('2026-11-30'), 3)).toBe('2027-02-28')
  })
})

describe('applyDeadlineRollover', () => {
  it.each([
    ['2026-04-25', '2026-04-27'],
    ['2026-05-31', '2026-06-01'],
    ['2026-07-25', '2026-07-27'],
    ['2026-10-25', '2026-10-26'],
    ['2026-11-10', '2026-11-10'],
    ['2027-01-10', '2027-01-11'],
    ['2027-01-25', '2027-01-25'],
    ['2027-03-31', '2027-03-31'],
  ])('moves %s to %s', (statutory, expected) => {
    expect(applyDeadlineRollover(d(statutory), new Set())).toBe(expected)
  })

  it('skips consecutive holidays after a weekend', () => {
    const holidays = new Set([d('2026-09-28')])
    expect(applyDeadlineRollover(d('2026-09-26'), holidays)).toBe('2026-09-29')
  })
})

describe('resolveFilingPeriods', () => {
  it('splits corporate VAT into preliminary and final periods', () => {
    const preliminary = find(corporate, '2026-2-preliminary')
    expect(preliminary).toMatchObject({ kind: 'preliminary', periodStart: '2026-07-01', periodEnd: '2026-09-30', dueDate: '2026-10-26' })
    const final = find(corporate, '2026-2-final')
    expect(final).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-12-31', statutoryDue: '2027-01-25', quarter: 4 })
  })

  it('gives notice-based VAT the whole half as the final period', () => {
    const notice = find(individual, '2026-1-notice')
    expect(notice).toMatchObject({ kind: 'notice', statutoryDue: null, dueDate: null, paymentDue: '2026-04-27' })
    expect(find(individual, '2026-1-final')).toMatchObject({ periodStart: '2026-01-01', periodEnd: '2026-06-30' })
  })

  it('switches withholding to semiannual deadlines', () => {
    const company = { ...corporate, withholdingSemiannual: true }
    expect(find(company, '2026-H2-semiannual')).toMatchObject({ statutoryDue: '2027-01-10', dueDate: '2027-01-11' })
    expect(() => find(company, '2026-10-payment')).toThrow()
  })

  it('labels withholding by payment month', () => {
    expect(find(corporate, '2026-10-payment')).toMatchObject({ periodStart: '2026-10-01', dueDate: '2026-11-10', quarter: 4 })
  })

  it('computes corporation tax deadlines from the fiscal year end', () => {
    expect(find(corporate, '2026-FY')).toMatchObject({ statutoryDue: '2027-03-31' })
    expect(find({ ...corporate, sincereFilingTarget: true }, '2026-FY')).toMatchObject({ statutoryDue: '2027-04-30' })
    expect(find({ ...corporate, fiscalYearEndMonth: 6 }, '2026-FY')).toMatchObject({
      periodStart: '2025-07-01',
      periodEnd: '2026-06-30',
      statutoryDue: '2026-09-30',
    })
  })

  it('computes aggregate income tax for individuals only', () => {
    expect(find(individual, '2025-annual')).toMatchObject({ taxType: 'aggr_income_tax', statutoryDue: '2026-05-31', dueDate: '2026-06-01' })
    expect(find({ ...individual, sincereFilingTarget: true }, '2025-annual')).toMatchObject({ statutoryDue: '2026-06-30' })
    expect(() => find(corporate, '2025-annual')).toThrow()
  })

  it('filters by payment deadline', () => {
    const periods = resolveFilingPeriods({ company: corporate, from: d('2026-11-01'), to: d('2026-11-30'), holidays: new Set() })
    expect(periods.map((p) => p.taxPeriodKey)).toEqual(['2026-10-payment'])
  })
})
