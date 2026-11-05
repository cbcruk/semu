import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_TAX_PROFILE, DEMO_VAT_EVIDENCE } from '../tax-demo.ts'
import { taxTestApp } from '../tax-http.testing.ts'
import type { TaxTestApp } from '../tax-http.testing.ts'

let app: TaxTestApp
afterEach(() => app.dispose())

describe('GET /v1/vat-estimates/current', () => {
  it('estimates the quarter of the given date for a corporation', async () => {
    app = taxTestApp({ profiles: [DEMO_TAX_PROFILE], vatEvidence: DEMO_VAT_EVIDENCE })

    const response = await app.send('/vat-estimates/current?on=2026-11-05')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      period: { start: '2026-10-01', end: '2026-12-31', unit: 'QUARTER' },
      asOf: '2026-11-05',
      outputTax: 100_000,
      inputTax: 30_000,
      estimatedTax: 70_000,
      cardSplitEstimated: true,
    })
  })

  it('uses the half year for an individual and the full card ratio without a profile', async () => {
    app = taxTestApp({ vatEvidence: DEMO_VAT_EVIDENCE })

    const response = await app.send('/vat-estimates/current?on=2026-11-05', { token: 'individual' })

    expect(await response.json()).toMatchObject({ period: { start: '2026-07-01', unit: 'HALF' }, outputTax: 100_000 })
  })

  it('rejects an impossible date', async () => {
    app = taxTestApp()

    const response = await app.send('/vat-estimates/current?on=2026-02-30')

    expect(response.status).toBe(400)
  })
})

describe('GET /v1/vat-estimates', () => {
  it('gives a point per started half year, estimated without filings', async () => {
    app = taxTestApp({ vatEvidence: DEMO_VAT_EVIDENCE })

    const response = await app.send('/vat-estimates?years=1')
    const { items } = await response.json()

    expect(items[0]).toMatchObject({ half: 1 })
    expect(items.every((item: { source: string }) => item.source === 'ESTIMATED')).toBe(true)
  })
})
