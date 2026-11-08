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

describe('결제 수단(/v1/billing-mandates)', () => {
  it('새 계좌를 등록하면 이전 계좌를 해지하고 계좌번호 전체는 돌려주지 않습니다', async () => {
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

  it('거절된 계좌도 기록에 남기고 422로 답합니다', async () => {
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

  it('납부자번호를 검사하고 멱등 키를 요구합니다', async () => {
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

describe('도입 문의 신청(POST /v1/consultations)', () => {
  const request = {
    products: ['TAXATION'],
    name: '김알프',
    phone: '01012345678',
    email: 'cafe@semu.example',
    privacyConsent: true,
    thirdPartyConsent: true,
  }

  it('현재 회사의 도입 문의를 기록하고 열려 있는 동안 중복 신청을 거절합니다', async () => {
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

  it('회사가 이미 쓰는 상품의 문의는 거절합니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/consultations', { token, body: request })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'PRODUCT_ALREADY_SUBSCRIBED', products: ['TAXATION'] })
  })

  it('두 동의를 모두 받아야 합니다', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('POST', '/v1/consultations', {
      token,
      body: { ...request, thirdPartyConsent: false },
    })

    expect(response.status).toBe(400)
  })
})

describe('서비스 계약(/v1/service-contracts)', () => {
  it('기장 고객의 서비스 계약을 보여 줍니다', async () => {
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

  it('다른 회사의 서비스 계약은 보이지 않습니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request(
      'GET',
      `/v1/service-contracts/${DEMO_SERVICE_CONTRACT_IDS.individualBookkeeping}`,
      { token },
    )

    expect(response.status).toBe(404)
  })

  it('무료 고객에게는 세무 아웃소싱 플랜 구독을 요구합니다', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('GET', '/v1/service-contracts', { token })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['TAXATION'] })
  })
})
