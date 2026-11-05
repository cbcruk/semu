import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_FILINGS, DEMO_HOLIDAYS, DEMO_TAX_PROFILE } from '../tax-demo.ts'
import { taxTestApp } from '../tax-http.testing.ts'
import type { TaxTestApp } from '../tax-http.testing.ts'

let app: TaxTestApp
afterEach(() => app.dispose())

describe('GET /v1/tax-calendar', () => {
  it('lists the year by payment due and links the filings that exist', async () => {
    app = taxTestApp({ profiles: [DEMO_TAX_PROFILE], holidays: DEMO_HOLIDAYS, filings: DEMO_FILINGS })

    const response = await app.send('/tax-calendar?year=2026')
    const { items } = await response.json()

    expect(response.status).toBe(200)
    expect(items.every((item: { paymentDue: string }) => item.paymentDue.startsWith('2026-'))).toBe(true)
    expect(
      items.find(
        (item: { periodKey: string; taxType: string }) =>
          item.taxType === 'WITHHOLDING_TAX' && item.periodKey === '2026-10',
      ),
    ).toMatchObject({
      dueDate: '2026-11-10',
      filingId: DEMO_FILINGS[0]!.id,
      filingStatus: 'REQUESTED',
    })
    expect(items.find((item: { periodKey: string }) => item.periodKey === '2026-09')).toMatchObject({
      dueDate: '2026-10-12',
      filingId: null,
    })
  })

  it('needs a tax profile', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-calendar?year=2026')

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'TAX_PROFILE_NOT_FOUND' })
  })

  it('validates the year', async () => {
    app = taxTestApp({ profiles: [DEMO_TAX_PROFILE] })

    const response = await app.send('/tax-calendar?year=26.5')

    expect(response.status).toBe(400)
  })
})
