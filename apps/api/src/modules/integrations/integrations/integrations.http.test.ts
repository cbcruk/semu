import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { makeTestApp } from '../../identity-access/testing-http.ts'
import type { TestApp } from '../../identity-access/testing-http.ts'
import { DEMO_INTEGRATION_IDS, DEMO_SIGN_PASSWORD } from '../demo-seed.ts'

let app: TestApp
let token: string

beforeEach(async () => {
  app = makeTestApp()
  token = (await app.signIn('owner@semu.example')).token
})

afterEach(() => app.dispose())

describe('기관 연동 목록(GET /v1/integrations)', () => {
  it('회사의 연동을 한도와 함께 보여 주고 비밀 값은 돌려주지 않습니다', async () => {
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

  it('경리 구성원은 연동을 읽기만 하고 등록하지 못합니다', async () => {
    const member = await app.signIn('member@semu.example')

    expect((await app.request('GET', '/v1/integrations', { token: member.token })).status).toBe(200)
    const denied = await app.request('POST', '/v1/integrations', {
      token: member.token,
      body: { type: 'CARD_SALES', authMethod: 'ID_PASSWORD', accountId: 'crefia', password: 'pw-1234' },
    })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'integration:create' })
  })

  it('다른 회사의 연동은 보여 주지 않습니다', async () => {
    const other = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('GET', `/v1/integrations/${DEMO_INTEGRATION_IDS.bank}`, { token: other.token })

    expect(response.status).toBe(404)
  })
})

describe('기관 연동 등록(POST /v1/integrations)', () => {
  it('카드 후보를 조회한 뒤 고른 새 카드만 등록합니다', async () => {
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

  it('PG 상점아이디를 등록하면 비밀 키를 가리고 허용할 IP를 알려 줍니다', async () => {
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

  it('규칙 위반마다 그 오류 코드로 답합니다', async () => {
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

  it('등록한 인증서로 홈택스를 연동하면 세금계산서를 발행할 수 있습니다', async () => {
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

describe('연동 항목·자격 증명·삭제', () => {
  it('카드 번호를 고치고 계좌를 끈 뒤 지웁니다', async () => {
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

  it('기관에서 확인한 뒤에 비밀번호를 바꿉니다', async () => {
    const path = `/v1/integrations/${DEMO_INTEGRATION_IDS.hometax}:replace-credentials`

    const rejected = await app.request('POST', path, { token, body: { password: 'wrong-again' } })
    const replaced = await app.request('POST', path, { token, body: { password: 'new-password' } })

    expect(rejected.status).toBe(422)
    expect(replaced.status).toBe(200)
    expect((await replaced.json()).version).toBe(2)
  })

  it('연동을 지웁니다', async () => {
    const response = await app.request('DELETE', `/v1/integrations/${DEMO_INTEGRATION_IDS.hometax}`, { token })

    expect(response.status).toBe(204)
    expect((await app.request('GET', `/v1/integrations/${DEMO_INTEGRATION_IDS.hometax}`, { token })).status).toBe(404)
  })
})

describe('공동인증서', () => {
  const upload = {
    name: '주식회사 세무',
    oid: '1.2.410.200005.1.1.2',
    serialNumber: 'NEW-0001',
    issuedOn: '2026-01-02',
    expiresOn: '2099-01-01',
    ownerBusinessNumber: '123-81-45600',
    encryptedBundle: 'bundle',
    signPassword: 'sign-1234',
  }

  it('인증서를 파생한 상태와 연동할 수 있는 기관과 함께 보여 줍니다', async () => {
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

  it('회사의 인증서를 등록하고 같은 인증서를 다시 등록하거나 다른 명의면 거절합니다', async () => {
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

  it('서명 비밀번호를 확인하고, 인증서를 지우면 그 연동을 UNREGISTERED로 표시합니다', async () => {
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

  it('인터넷지로 비밀번호는 보관하지 않고 인터넷지로에 가입합니다', async () => {
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
