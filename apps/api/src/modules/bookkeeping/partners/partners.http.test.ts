import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestApp } from '../common/test-app.ts'
import { testApp } from '../common/test-app.ts'

let app: TestApp
beforeEach(() => {
  app = testApp()
})
afterEach(() => app.dispose())

const ECOPRO = 'ptn_01JBQ000000000000000000001'

describe('/v1/partners', () => {
  it('shows live outstanding amounts from classified evidence minus links', async () => {
    const ecopro = await app.send('GET', `/v1/partners/${ECOPRO}`)
    const office = await app.send('GET', '/v1/partners/ptn_01JBQ000000000000000000002')

    expect(await ecopro.json()).toMatchObject({ outstanding: { salesAmount: 0, purchaseAmount: 0 } })
    expect(await office.json()).toMatchObject({ outstanding: { salesAmount: 0, purchaseAmount: 11_000_000 } })
  })

  it('creates a partner, looks up its business status and masks its account', async () => {
    const response = await app.send('POST', '/v1/partners', {
      body: {
        type: 'CORPORATE_BUSINESS',
        roles: ['PURCHASE'],
        name: '폐업상사',
        representativeName: '홍길동',
        businessNumber: '123-45-67899',
        bankAccounts: [{ bankCode: '004', accountNumber: '111-222-333444' }],
      },
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      businessNumber: '1234567899',
      businessStatus: 'CLOSED',
      bankAccounts: [{ bankCode: '004', accountNumberMasked: '****3444', isPrimary: true }],
    })
  })

  it('refuses a duplicate business number with 409', async () => {
    const response = await app.send('POST', '/v1/partners', {
      body: {
        type: 'CORPORATE_BUSINESS',
        roles: ['SALES'],
        name: '에코프로 중복',
        representativeName: '대표',
        businessNumber: '1108100011',
      },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'PARTNER_BUSINESS_NUMBER_DUPLICATE', partnerId: ECOPRO })
  })

  it('requires a business number for business partners', async () => {
    const response = await app.send('POST', '/v1/partners', {
      body: { type: 'INDIVIDUAL_BUSINESS', roles: ['SALES'], name: '개인사업자', representativeName: '대표' },
    })

    expect(response.status).toBe(422)
  })

  it('soft deletes a partner', async () => {
    const deleted = await app.send('DELETE', `/v1/partners/${ECOPRO}`)
    const after = await app.send('GET', `/v1/partners/${ECOPRO}`)
    const listed = await app.send('GET', '/v1/partners?role=SALES')

    expect(deleted.status).toBe(204)
    expect(after.status).toBe(404)
    expect(((await listed.json()) as { items: unknown[] }).items).toEqual([])
  })
})

describe('GET /v1/business-statuses/{businessNumber}', () => {
  it('answers from the lookup and then from the same-day cache', async () => {
    const first = await app.send('GET', '/v1/business-statuses/220-81-00028')
    const second = await app.send('GET', '/v1/business-statuses/2208100028')
    const a = await first.json()

    expect(a).toMatchObject({ businessNumber: '2208100028', status: 'SUSPENDED' })
    expect(await second.json()).toEqual(a)
  })

  it('rejects a malformed number', async () => {
    const response = await app.send('GET', '/v1/business-statuses/12345')

    expect(response.status).toBe(400)
  })
})
