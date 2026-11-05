import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../identity-access/identity-access.public.ts'
import { makeTestApp } from '../identity-access/testing-http.ts'
import type { TestApp } from '../identity-access/testing-http.ts'
import { DEMO_SERVICE_CONTRACT_IDS } from './billing-seed.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

const account = {
  bankCode: '004',
  accountNumber: '123-456-789012',
  accountHolder: '세무 카페',
  payerNumber: '1048145235',
}

describe('/v1/billing-mandates', () => {
  it('registers a new account, revokes the previous one and never returns the full number', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/billing-mandates', {
      token,
      headers: { 'idempotency-key': 'mandate-1' },
      body: account,
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      status: 'REGISTERED',
      accountNumberMasked: '********9012',
      source: 'ONLINE',
    })
    const { items } = await (await app.request('GET', '/v1/billing-mandates', { token })).json()
    expect(items.map((item: { status: string }) => item.status)).toEqual(['REGISTERED', 'REVOKED'])
    expect(JSON.stringify(items)).not.toContain('789012')
  })

  it('keeps a rejected account on record and answers 422', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('POST', '/v1/billing-mandates', {
      token,
      headers: { 'idempotency-key': 'mandate-2' },
      body: { ...account, accountNumber: '123-456-780000' },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'MANDATE_REJECTED', reason: 'ACCOUNT_NOT_FOUND' })
    const { items } = await (await app.request('GET', '/v1/billing-mandates', { token })).json()
    expect(items).toEqual([expect.objectContaining({ status: 'REJECTED' })])
  })

  it('validates the payer number and requires an idempotency key', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const invalid = await app.request('POST', '/v1/billing-mandates', {
      token,
      headers: { 'idempotency-key': 'mandate-3' },
      body: { ...account, payerNumber: '12' },
    })
    const missingKey = await app.request('POST', '/v1/billing-mandates', { token, body: account })

    expect(invalid.status).toBe(400)
    expect(missingKey.status).toBe(428)
  })
})

describe('POST /v1/consultations', () => {
  const request = {
    products: ['TAXATION'],
    name: '김알프',
    phone: '01012345678',
    email: 'cafe@semu.example',
    privacyConsent: true,
    thirdPartyConsent: true,
  }

  it('records a lead for the current company and refuses a duplicate while it is open', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const first = await app.request('POST', '/v1/consultations', { token, body: request })
    const second = await app.request('POST', '/v1/consultations', {
      token,
      body: { ...request, products: ['TAXATION', 'PAYROLL'] },
    })

    expect(first.status).toBe(201)
    expect(await first.json()).toMatchObject({
      id: expect.stringMatching(/^led_/),
      status: 'NEW',
      products: ['TAXATION'],
    })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ code: 'CONSULTATION_ALREADY_OPEN' })
  })

  it('refuses an inquiry for products the company already has', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/consultations', { token, body: request })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'PRODUCT_ALREADY_SUBSCRIBED', products: ['TAXATION'] })
  })

  it('requires both consents', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('POST', '/v1/consultations', {
      token,
      body: { ...request, thirdPartyConsent: false },
    })

    expect(response.status).toBe(400)
  })
})

describe('/v1/service-contracts', () => {
  it('lists the contracts of a bookkeeping customer', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const { items } = await (await app.request('GET', '/v1/service-contracts', { token })).json()
    const detail = await app.request(
      'GET',
      `/v1/service-contracts/${DEMO_SERVICE_CONTRACT_IDS.corporationBookkeeping}`,
      {
        token,
      },
    )

    expect(items.map((item: { type: string }) => item.type).sort()).toEqual(['BOOKKEEPING', 'SOCIAL_INSURANCE_AGENCY'])
    expect(await detail.json()).toMatchObject({ monthlyFee: 350000, adjustmentFeeMonth: 3, autoRenew: true })
  })

  it('hides contracts of another company', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request(
      'GET',
      `/v1/service-contracts/${DEMO_SERVICE_CONTRACT_IDS.individualBookkeeping}`,
      { token },
    )

    expect(response.status).toBe(404)
  })

  it('asks a free company to subscribe to the taxation plan', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('GET', '/v1/service-contracts', { token })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['TAXATION'] })
  })
})
