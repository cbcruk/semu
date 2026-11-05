import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { makeTestApp } from '../../identity-access/testing-http.ts'
import type { TestApp } from '../../identity-access/testing-http.ts'
import { DEMO_INTEGRATION_IDS, DEMO_SIGN_PASSWORD } from '../demo-seed.ts'

let app: TestApp
let token: string

beforeEach(async () => {
  app = makeTestApp()
  token = (await app.signIn('owner@alfred.example')).token
})

afterEach(() => app.dispose())

describe('GET /v1/integrations', () => {
  it('lists the company links with limits and never returns secrets', async () => {
    const response = await app.request('GET', '/v1/integrations', { token })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      DEMO_INTEGRATION_IDS.hometax,
      DEMO_INTEGRATION_IDS.bank,
    ])
    expect(body.limits).toContainEqual({ type: 'BANK', max: 20, used: 2, unit: 'ITEM' })
    expect(JSON.stringify(body)).not.toMatch(/password|1234/)
    expect(body.items[0]).toMatchObject({
      type: 'HOMETAX',
      authMethod: 'ID_PASSWORD',
      canIssueTaxInvoice: false,
      status: 'ACTIVE',
      allowedActions: ['SCRAP', 'REPLACE_CREDENTIALS', 'DELETE'],
    })
  })

  it('lets a bookkeeping member read but not register', async () => {
    const member = await app.signIn('member@alfred.example')

    expect((await app.request('GET', '/v1/integrations', { token: member.token })).status).toBe(200)
    const denied = await app.request('POST', '/v1/integrations', {
      token: member.token,
      body: { type: 'CARD_SALES', authMethod: 'ID_PASSWORD', accountId: 'crefia', password: 'pw-1234' },
    })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'integration:create' })
  })

  it('does not show another company link', async () => {
    const other = await app.signIn('owner@alfred.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('GET', `/v1/integrations/${DEMO_INTEGRATION_IDS.bank}`, { token: other.token })

    expect(response.status).toBe(404)
  })
})

describe('POST /v1/integrations', () => {
  it('looks up card candidates, then registers only the chosen new ones', async () => {
    const login = {
      type: 'CREDIT_CARD',
      authMethod: 'ID_PASSWORD',
      institutionCodes: ['001'],
      accountId: 'card',
      password: 'pw-1',
    }

    const candidates = await app.request('POST', '/v1/integrations:list-candidates', { token, body: login })
    const created = await app.request('POST', '/v1/integrations', {
      token,
      body: { ...login, itemKeys: ['001-1', '001-2'] },
    })
    const again = await app.request('POST', '/v1/integrations', { token, body: { ...login, itemKeys: ['001-1'] } })

    expect(candidates.status).toBe(200)
    expect((await candidates.json()).items).toHaveLength(3)
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      type: 'CREDIT_CARD',
      institutionCode: '001',
      accountId: 'card',
      items: [
        { key: '001-1', kind: 'CARD', numberMasked: '****1111', isActive: true },
        { key: '001-2', kind: 'CARD', numberMasked: '****2222' },
      ],
    })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: 'INTEGRATION_DUPLICATE', reason: 'NO_NEW_ITEMS' })
  })

  it('registers a PG MID, masks the secret key and tells the IP to whitelist', async () => {
    const response = await app.request('POST', '/v1/integrations', {
      token,
      body: {
        type: 'PG',
        authMethod: 'API_KEY',
        institutionCodes: ['NICEPAY'],
        mid: 'nice01',
        keys: { usrId: 'admin', merchantKey: 'mk-secret' },
      },
    })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({
      accountId: 'nice01',
      keys: { usrId: 'admin', merchantKey: '********' },
      ipWhitelist: '52.78.5.241',
    })
    expect(JSON.stringify(body)).not.toContain('mk-secret')
  })

  it('answers the rule violations with their own codes', async () => {
    const toss = await app.request('POST', '/v1/integrations', {
      token,
      body: {
        type: 'PG',
        authMethod: 'API_KEY',
        institutionCodes: ['TOSSPAYMENTS'],
        mid: 'CF_shop',
        keys: { secretKey: 's' },
      },
    })
    const giro = await app.request('POST', '/v1/integrations', {
      token,
      body: { type: 'GIRO', authMethod: 'ID_PASSWORD', accountId: 'giro', password: 'pw' },
    })
    const hometax = await app.request('POST', '/v1/integrations', {
      token,
      body: { type: 'HOMETAX', authMethod: 'ID_PASSWORD', accountId: 'again', password: 'pw' },
    })
    const missing = await app.request('POST', '/v1/integrations', {
      token,
      body: { type: 'CARD_SALES', authMethod: 'ID_PASSWORD', accountId: 'crefia' },
    })
    const wrong = await app.request('POST', '/v1/integrations', {
      token,
      body: { type: 'CARD_SALES', authMethod: 'ID_PASSWORD', accountId: 'crefia', password: 'wrong-pw' },
    })

    expect([toss.status, giro.status, hometax.status, missing.status, wrong.status]).toEqual([422, 422, 409, 400, 422])
    expect(await toss.json()).toMatchObject({ code: 'PG_KEYS_INVALID', reason: 'MID_NOT_SUPPORTED', field: 'mid' })
    expect(await giro.json()).toMatchObject({ code: 'AUTH_METHOD_NOT_SUPPORTED' })
    expect(await hometax.json()).toMatchObject({ code: 'INTEGRATION_DUPLICATE', reason: 'SAME_INTEGRATION' })
    expect(await missing.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      violations: [{ field: 'password', code: 'REQUIRED' }],
    })
    expect(await wrong.json()).toMatchObject({ code: 'INSTITUTION_CREDENTIAL_REJECTED', reason: 'INVALID_CREDENTIAL' })
  })

  it('links hometax with the registered certificate so tax invoices can be issued', async () => {
    const response = await app.request('POST', '/v1/integrations', {
      token,
      body: { type: 'HOMETAX', authMethod: 'CERTIFICATE', certificateId: DEMO_INTEGRATION_IDS.certificate },
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      certificateId: DEMO_INTEGRATION_IDS.certificate,
      certificateStatus: 'ACTIVE',
      canIssueTaxInvoice: true,
      usableForTaxFiling: false,
    })
  })
})

describe('items, credentials and removal', () => {
  it('fixes a card number, switches an account off and removes it', async () => {
    const path = `/v1/integrations/${DEMO_INTEGRATION_IDS.bank}/items/004-2`

    const off = await app.request('PATCH', path, { token, body: { isActive: false } })
    const removed = await app.request('DELETE', path, { token })
    const after = await (await app.request('GET', `/v1/integrations/${DEMO_INTEGRATION_IDS.bank}`, { token })).json()

    expect(off.status).toBe(200)
    expect((await off.json()).items[1]).toMatchObject({ isActive: false, allowedActions: ['ACTIVATE', 'DELETE'] })
    expect(removed.status).toBe(204)
    expect(after.items.map((item: { key: string }) => item.key)).toEqual(['004-1'])
    expect(after.version).toBe(3)
  })

  it('replaces a password after checking it with the institution', async () => {
    const path = `/v1/integrations/${DEMO_INTEGRATION_IDS.hometax}:replace-credentials`

    const rejected = await app.request('POST', path, { token, body: { password: 'wrong-again' } })
    const replaced = await app.request('POST', path, { token, body: { password: 'new-password' } })

    expect(rejected.status).toBe(422)
    expect(replaced.status).toBe(200)
    expect((await replaced.json()).version).toBe(2)
  })

  it('deletes a link', async () => {
    const response = await app.request('DELETE', `/v1/integrations/${DEMO_INTEGRATION_IDS.hometax}`, { token })

    expect(response.status).toBe(204)
    expect((await app.request('GET', `/v1/integrations/${DEMO_INTEGRATION_IDS.hometax}`, { token })).status).toBe(404)
  })
})

describe('certificates', () => {
  const upload = {
    name: '주식회사 알프레드',
    oid: '1.2.410.200005.1.1.2',
    serialNumber: 'NEW-0001',
    issuedOn: '2026-01-02',
    expiresOn: '2099-01-01',
    ownerBusinessNumber: '123-81-45600',
    encryptedBundle: 'bundle',
    signPassword: 'sign-1234',
  }

  it('lists certificates with their derived status and the institutions they can link', async () => {
    const body = await (await app.request('GET', '/v1/certificates', { token })).json()

    expect(body.items).toEqual([
      expect.objectContaining({
        id: DEMO_INTEGRATION_IDS.certificate,
        ownerType: 'BUSINESS',
        usage: 'GENERAL',
        status: 'ACTIVE',
        usableFor: ['HOMETAX', 'GIRO', 'BANK', 'CREDIT_CARD'],
        linkedIntegrationIds: [],
      }),
    ])
    expect(JSON.stringify(body)).not.toContain(DEMO_SIGN_PASSWORD)
  })

  it('registers a certificate of the company and refuses a second copy or another owner', async () => {
    const created = await app.request('POST', '/v1/certificates', { token, body: upload })
    const duplicate = await app.request('POST', '/v1/certificates', { token, body: upload })
    const stranger = await app.request('POST', '/v1/certificates', {
      token,
      body: { ...upload, serialNumber: 'NEW-0002', ownerBusinessNumber: '2208162517' },
    })
    const badPassword = await app.request('POST', '/v1/certificates', {
      token,
      body: { ...upload, serialNumber: 'NEW-0003', signPassword: 'wrong-sign' },
    })

    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      ownerType: 'BUSINESS',
      usage: 'BANK',
      usableFor: ['GIRO', 'BANK', 'CREDIT_CARD'],
    })
    expect(duplicate.status).toBe(409)
    expect(await stranger.json()).toMatchObject({
      code: 'CERTIFICATE_NOT_ACCEPTED',
      reason: 'OWNER_MISMATCH',
      field: 'ownerBusinessNumber',
    })
    expect(await badPassword.json()).toMatchObject({ code: 'CERTIFICATE_PASSWORD_INCORRECT' })
  })

  it('checks the signing password and marks links UNREGISTERED once the certificate is deleted', async () => {
    const path = `/v1/certificates/${DEMO_INTEGRATION_IDS.certificate}`
    const linked = await (
      await app.request('POST', '/v1/integrations', {
        token,
        body: { type: 'HOMETAX', authMethod: 'CERTIFICATE', certificateId: DEMO_INTEGRATION_IDS.certificate },
      })
    ).json()

    const wrong = await app.request('POST', `${path}:verify-password`, { token, body: { signPassword: 'nope' } })
    const right = await app.request('POST', `${path}:verify-password`, {
      token,
      body: { signPassword: DEMO_SIGN_PASSWORD },
    })
    const removed = await app.request('DELETE', path, { token })
    const link = await (await app.request('GET', `/v1/integrations/${linked.id}`, { token })).json()

    expect([wrong.status, right.status, removed.status]).toEqual([422, 204, 204])
    expect(link).toMatchObject({
      certificateStatus: 'UNREGISTERED',
      status: 'ERROR',
      allowedActions: ['REPLACE_CREDENTIALS', 'DELETE'],
    })
  })

  it('signs up to Internet Giro without keeping the Giro password', async () => {
    const response = await app.request('POST', `/v1/certificates/${DEMO_INTEGRATION_IDS.certificate}:join-giro`, {
      token,
      body: {
        giroLoginId: 'giro',
        giroPassword: 'giro-pw',
        email: 'a@b.example',
        phone: '01012345678',
        agreedToGiroTerms: true,
      },
    })

    expect(response.status).toBe(204)
  })
})
