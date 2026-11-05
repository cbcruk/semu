import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestApp } from '../../src/modules/identity-access/testing-http.ts'

const app = makeTestApp()
const ON = '2026-11-30'

let owner = ''

beforeAll(async () => {
  owner = (await app.signIn('owner@alfred.example')).token
})

afterAll(() => app.dispose())

async function get(path: string): Promise<any> {
  const response = await app.request('GET', path, { token: owner })
  expect(response.status).toBe(200)
  return response.json()
}

describe('Integrations → Bookkeeping → Tax', () => {
  let before: any

  it('sends a Hometax scrap batch into the bookkeeping evidence ledger', async () => {
    before = await get(`/v1/vat-estimates/current?on=${ON}`)

    const accepted = await app.request('POST', '/v1/scrap-requests', {
      token: owner,
      headers: { 'idempotency-key': 'hometax-1' },
      body: { institutionType: 'HOMETAX' },
    })
    expect(accepted.status).toBe(202)
    const job = await get(`/v1/scrap-requests/${(await accepted.json()).id}`)
    expect(job.status).toBe('SUCCEEDED')

    const evidence = await get('/v1/evidence?side=SALES&source=TAX_INVOICE&from=2026-11-01&to=2026-11-01')
    expect(evidence.items).toHaveLength(2)
    expect(
      evidence.items
        .map((row: { amounts: { totalAmount: number } }) => row.amounts.totalAmount)
        .toSorted((a: number, b: number) => a - b),
    ).toEqual([10_000, 20_000])
  })

  it('feeds the ingested evidence into the VAT estimate', async () => {
    const after = await get(`/v1/vat-estimates/current?on=${ON}`)

    expect(after.period).toEqual({ start: '2026-10-01', end: '2026-12-31', unit: 'QUARTER' })
    expect(after.outputTax - before.outputTax).toBe(910 + 1_819)
  })

  it('shows the Tax estimate and its rolled-forward due date on the bookkeeping home card', async () => {
    const estimate = await get(`/v1/vat-estimates/current?on=${ON}`)
    const home = await get(`/v1/reports/home-summary?date=${ON}`)

    expect(home.vat).toMatchObject({
      periodStart: estimate.period.start,
      periodEnd: estimate.period.end,
      estimatedTaxAmount: estimate.estimatedTax,
      dueDate: '2027-01-25',
    })
  })
})

describe('Bookkeeping → Integrations', () => {
  it('checks a new partner against the Integrations business status lookup', async () => {
    const created = await app.request('POST', '/v1/partners', {
      token: owner,
      body: {
        type: 'CORPORATE_BUSINESS',
        roles: ['PURCHASE'],
        name: '폐업상사',
        representativeName: '홍길동',
        businessNumber: '2208100018',
      },
    })
    const lookup = await get('/v1/business-statuses/2208100018')

    expect(created.status).toBe(201)
    expect(lookup).toMatchObject({ status: 'CLOSED', closedOn: '2025-12-31' })
    expect((await created.json()).businessStatus).toBe('CLOSED')
  })
})
