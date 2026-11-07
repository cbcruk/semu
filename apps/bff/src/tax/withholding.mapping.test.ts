import { describe, expect, it } from 'vitest'
import { fromProblem } from '../legacy-error.ts'
import type { FilingSummary } from '../upstream.types.ts'
import {
  filingCovering,
  legacyFilingOrder,
  legacyFilingStatus,
  legacyPeriodKey,
  requirementCodeOf,
  toLegacyFiling,
  toLegacyFilingError,
} from './withholding.mapping.ts'

function filing(fields: Partial<FilingSummary> & Pick<FilingSummary, 'id'>): FilingSummary {
  return {
    taxType: 'WITHHOLDING_TAX',
    kind: 'MONTHLY',
    periodKey: '2026-10',
    revision: 0,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    statutoryDue: '2026-11-10',
    dueDate: '2026-11-10',
    paymentDue: '2026-11-10',
    submitDue: null,
    status: 'SCHEDULED',
    isOverdue: false,
    progress: { stage: null, index: 0, count: 5 },
    payableAmount: null,
    settlement: null,
    paidOn: null,
    ledgerUploadedAt: null,
    ledgerConfirmedAt: null,
    ledgerDisputeCount: 0,
    paymentSlipSentAt: null,
    version: 1,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...fields,
  }
}

describe('withholding filing shape', () => {
  it('writes the legacy period key, year and quarter of monthly and semiannual filings', () => {
    expect(legacyPeriodKey({ kind: 'MONTHLY', periodKey: '2026-03' })).toBe('2026-03-payment')
    expect(legacyPeriodKey({ kind: 'SEMIANNUAL', periodKey: '2026-H2' })).toBe('2026-H2-semiannual')
    expect(toLegacyFiling(filing({ id: 'fil_a', periodStart: '2026-03-01' }))).toMatchObject({ year: 2026, quarter: 1 })
    expect(
      toLegacyFiling(filing({ id: 'fil_b', kind: 'SEMIANNUAL', periodKey: '2026-H1', periodStart: '2026-01-01' })),
    ).toMatchObject({ tax_period_key: '2026-H1-semiannual', quarter: 2 })
    expect(
      toLegacyFiling(filing({ id: 'fil_c', kind: 'SEMIANNUAL', periodKey: '2026-H2', periodStart: '2026-07-01' })),
    ).toMatchObject({ quarter: 4 })
  })

  it('has no legacy step before materials are requested and after cancelling, and spells cancelled the legacy way', () => {
    expect(toLegacyFiling(filing({ id: 'fil_a' }))).toMatchObject({ step: null, step_index: 0, step_count: 5 })
    expect(toLegacyFiling(filing({ id: 'fil_b', status: 'CANCELED' }))).toMatchObject({
      status: 'cancelled',
      step: null,
    })
    expect(legacyFilingStatus('LEDGER_PENDING')).toBe('ledger_pending')
  })

  it('takes only lower-case withholding requirement codes', () => {
    expect(requirementCodeOf('daily_wage')).toBe('DAILY_WAGE')
    expect(requirementCodeOf('DAILY_WAGE')).toBeUndefined()
    expect(requirementCodeOf('pg_online_sales')).toBeUndefined()
    expect(requirementCodeOf('toString')).toBeUndefined()
  })

  it('orders like the legacy SQL and finds the covering filing without cancelled ones', () => {
    const filings = [
      filing({ id: 'fil_b', periodStart: '2026-09-01', periodEnd: '2026-09-30' }),
      filing({ id: 'fil_d', revision: 1 }),
      filing({ id: 'fil_c' }),
      filing({ id: 'fil_a' }),
    ]
    expect(legacyFilingOrder(filings).map((item) => item.id)).toEqual(['fil_d', 'fil_a', 'fil_c', 'fil_b'])
    expect(filingCovering(filings, '2026-10')?.id).toBe('fil_d')
    expect(filingCovering([filing({ id: 'fil_x', status: 'CANCELED', revision: 2 }), ...filings], '2026-10')?.id).toBe(
      'fil_d',
    )
    expect(filingCovering(filings, '2026-11')).toBeUndefined()
  })
})

describe('filing errors', () => {
  it('uses the status the route read when the new API does not say it', () => {
    const locked = toLegacyFilingError(fromProblem(409, { code: 'FILING_LOCKED' }), 'REVIEWING')
    expect(locked.status).toBe(409)
    expect(locked.body).toEqual({
      detail: 'The filing is reviewing and does not allow this action.',
      code: 'INVALID_TRANSITION',
    })
  })

  it('names the agency when the command belongs to agency staff', () => {
    const error = toLegacyFilingError(
      fromProblem(403, { code: 'FILING_ACTOR_NOT_ALLOWED', action: 'CLOSE', requiredActorKind: 'AGENCY' }),
    )
    expect(error.body).toEqual({ detail: 'Only agency users can close a filing.', code: 'PERMISSION_DENIED' })
  })

  it('leaves other errors as the shared mapping made them', () => {
    const error = fromProblem(403, { code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['TAXATION'] })
    expect(toLegacyFilingError(error)).toBe(error)
  })
})
