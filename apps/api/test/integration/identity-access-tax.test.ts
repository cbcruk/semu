import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestApp } from '../../src/modules/identity-access/testing-http.ts'

const app = makeTestApp()

let owner = ''

beforeAll(async () => {
  owner = (await app.signIn('owner@alfred.example')).token
})

afterAll(() => app.dispose())

describe('Identity & Access + Billing → Tax', () => {
  it('builds the tax calendar from the company in Identity & Access and its plans in Billing', async () => {
    const response = await app.request('GET', '/v1/tax-calendar?year=2026', { token: owner })
    const { items } = await response.json()

    expect(response.status).toBe(200)
    expect(items.filter((item: { taxType: string; kind: string }) => item.kind === 'PRELIMINARY')).toHaveLength(2)
    expect(
      items.find(
        (item: { taxType: string; periodKey: string }) =>
          item.taxType === 'WITHHOLDING_TAX' && item.periodKey === '2026-09',
      ),
    ).toMatchObject({ dueDate: '2026-10-12', filingId: null })
  })
})
