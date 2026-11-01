import { sign } from 'hono/jwt'
import { describe, expect, it } from 'vitest'
import { queryAll, queryOne } from '../../src/db/query'
import { processScrapQueue } from '../../src/modules/platform/integrations/scrap.service'
import { resolvePlatformDeps } from '../../src/modules/platform/platform-deps'
import { PLATFORM_SEED } from '../../src/modules/platform/platform.seed'
import { CORP, createPlatformTestContext, USERS } from '../helpers/test-app'

const CERT = {
  cert_der_b64: 'MIIB-cert',
  key_enc_b64: 'MIIB-key',
  sign_pw: 'certpass1!',
  subject_dn: 'cn=주식회사데모,ou=corporation,o=yessign,c=kr',
  oid: '1.2.410.200005.1.1.5',
  serial: '0a1b2c',
  pub_date: '2026-01-01',
  end_date: '2027-01-01',
  owner_name: '주식회사 데모',
  owner_business_number: '110-81-00001',
}

describe('institution integrations', () => {
  it('encrypts credentials at rest and never returns them', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    const rejected = await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/cardsales`, { json: { account_id: 'crefia-id', account_pw: 'wrong-pass' } })
    expect(rejected.status).toBe(422)
    const created = await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/cardsales/`, { json: { account_id: 'crefia-id', account_pw: 'plain-secret-77' } })
    expect(created.status).toBe(201)
    const text = await created.text()
    expect(text).not.toContain('plain-secret-77')
    const stored = queryAll<Record<string, unknown>>(ctx.db, 'SELECT * FROM integration_credentials')
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain('plain-secret-77')
    const listed = await (await ctx.call(admin, 'GET', `/api/company/${CORP}/integrations/v2?integration_type=cardsales`)).text()
    expect(listed).toContain('crefia-id')
    expect(listed).not.toContain('plain-secret-77')

    expect((await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/cardsales`, { json: { account_id: 'crefia-2', account_pw: 'other-1' } })).status).toBe(409)
  })

  it('applies the 10-minute manual collection cooldown with remain_seconds', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/cardsales`, { json: { account_id: 'crefia-id', account_pw: 'secret-1' } })
    const first = await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/request-scrapping/cardsales`, { json: {} })
    expect(first.status).toBe(201)
    expect(await first.json()).toMatchObject({ status: 'request', requester: 'user', can_scrapping: false })

    ctx.setNow('2026-11-01T09:04:00+09:00')
    const second = await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/request-scrapping/cardsales`, { json: {} })
    expect(second.status).toBe(429)
    expect(await second.json()).toMatchObject({ code: 'RATE_LIMITED', remain_seconds: 360 })
    const last = (await (await ctx.call(admin, 'GET', `/api/company/${CORP}/integrations/cardsales/last-scrap-request-status`)).json()) as { remain_seconds: number }
    expect(last.remain_seconds).toBe(360)

    ctx.setNow('2026-11-01T09:10:00+09:00')
    expect((await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/request-scrapping/cardsales`, { json: {} })).status).toBe(201)
  })

  it('runs queued collections through the adapter and hands batches to the sink', async () => {
    const ctx = await createPlatformTestContext()
    const batches: unknown[] = []
    const deps = resolvePlatformDeps({ ...ctx, jwtSecret: 'unused', taxTermsVersion: '2026-01', maxUploadBytes: 1, scrapResultSink: { ingest: (batch) => Promise.resolve(void batches.push(batch)) } })
    const admin = await ctx.token(USERS.admin, CORP)
    await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/cardsales`, { json: { account_id: 'crefia-id', account_pw: 'secret-1' } })
    const { id } = (await (await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/request-scrapping/cardsales`, { json: {} })).json()) as { id: string }
    expect(await processScrapQueue(deps)).toEqual({ done: 1, timedOut: 0 })
    expect(batches).toHaveLength(1)
    const polled = await ctx.call(admin, 'GET', `/api/company/${CORP}/integrations/scraping-status?id=${id}`)
    expect(await polled.json()).toMatchObject({ status: 'SUCCESS' })
  })

  it('stores collected card sales in the bookkeeping evidence by default, once per record', async () => {
    const ctx = await createPlatformTestContext()
    const deps = resolvePlatformDeps({ ...ctx, jwtSecret: 'unused', taxTermsVersion: '2026-01', maxUploadBytes: 1 })
    const admin = await ctx.token(USERS.admin, CORP)
    const count = (): number =>
      queryOne<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM sales_evidence WHERE company_id = ? AND source = 'card'", [CORP])?.n ?? 0
    const before = count()
    await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/cardsales`, { json: { account_id: 'crefia-id', account_pw: 'secret-1' } })
    await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/request-scrapping/cardsales`, { json: {} })
    await processScrapQueue(deps)
    expect(count()).toBe(before + 2)

    ctx.setNow('2026-11-01T10:00:00+09:00')
    await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/request-scrapping/cardsales`, { json: {} })
    await processScrapQueue(deps)
    expect(count()).toBe(before + 2)
  })

  it('refuses to collect from an institution that is not connected', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    expect((await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/request-scrapping/hometax`, { json: {} })).status).toBe(422)
  })
})

describe('certificates', () => {
  it('registers a business certificate in the company name and hides the key material', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    const created = await ctx.call(admin, 'POST', `/api/company/${CORP}/cert/`, { json: CERT })
    expect(created.status).toBe(201)
    const text = await created.text()
    expect(text).not.toContain('certpass1!')
    expect(text).not.toContain('MIIB-key')
    const stored = queryOne<{ sign_pw_enc: string }>(ctx.db, 'SELECT sign_pw_enc FROM certificates')
    expect(stored === undefined ? undefined : ctx.cipher.decrypt(stored.sign_pw_enc)).toBe('certpass1!')

    expect((await ctx.call(admin, 'POST', `/api/company/${CORP}/cert`, { json: CERT })).status).toBe(409)
    const others = await ctx.call(admin, 'POST', `/api/company/${CORP}/cert`, { json: { ...CERT, serial: 'ff', owner_business_number: '2201200002' } })
    expect(others.status).toBe(422)
    const wrongPassword = await ctx.call(admin, 'POST', `/api/company/${CORP}/cert`, { json: { ...CERT, serial: 'fe', sign_pw: 'wrong-pw' } })
    expect(wrongPassword.status).toBe(422)

    const listed = (await (await ctx.call(admin, 'GET', `/api/company/${CORP}/cert?detail=true`)).json()) as unknown[]
    expect(listed).toHaveLength(1)
  })

  it('connects Hometax with a registered certificate', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    const { id } = (await (await ctx.call(admin, 'POST', `/api/company/${CORP}/cert`, { json: CERT })).json()) as { id: string }
    const linked = await ctx.call(admin, 'POST', `/api/company/${CORP}/integrations/hometax`, { json: { auth_type: 'CERTIFICATE', cert_id: id, sign_pw: 'certpass1!' } })
    expect(linked.status).toBe(201)
    expect(await linked.json()).toMatchObject({ integration_type: 'hometax', auth_type: 'CERTIFICATE' })
  })
})

describe('external partners', () => {
  it('reports the payload state and links a company with the partner API key', async () => {
    const ctx = await createPlatformTestContext()
    const partner = ctx.anonymous()
    const payload = await sign({ iss: PLATFORM_SEED.partner.id, business_number: '110-81-00001', exp: 4_102_444_800 }, PLATFORM_SEED.partner.jwtSecret, 'HS256')
    const before = await partner.call('GET', '/api/external/validate_payload', { headers: { Authorization: `Bearer ${payload}` } })
    expect(await before.json()).toMatchObject({ state: 'EXISTS_COMPANY' })
    const admins = await partner.call('GET', '/api/external/company_system_admin_list', { headers: { Authorization: `Bearer ${payload}` } })
    expect(await admins.json()).toEqual([{ email: expect.stringMatching(/\*/) }, { email: expect.stringMatching(/\*/) }])

    const attached = await partner.call('POST', '/api/external/attach', {
      headers: { 'X-API-KEY': PLATFORM_SEED.partner.apiKey },
      json: { email: `${USERS.admin}@example.com`, password: PLATFORM_SEED.password, business_number: '1108100001' },
    })
    expect(attached.status).toBe(200)
    const after = await partner.call('GET', '/api/external/validate_payload', { headers: { Authorization: `Bearer ${payload}` } })
    expect(await after.json()).toMatchObject({ state: 'INTEGRATED' })

    const forged = await sign({ iss: PLATFORM_SEED.partner.id, business_number: '1108100001' }, 'not-the-secret', 'HS256')
    expect((await partner.call('GET', '/api/external/validate_payload', { headers: { Authorization: `Bearer ${forged}` } })).status).toBe(401)
    expect((await partner.call('POST', '/api/external/attach', { headers: { 'X-API-KEY': 'nope' }, json: {} })).status).toBe(422)
  })

  it('validates and consumes chat channel tokens with the legacy fail reasons', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.login(`${USERS.admin}@example.com`)
    const token = PLATFORM_SEED.chatChannelToken
    expect((await admin.call('GET', `/api/member/chat-channel/?token=${token}`)).status).toBe(200)
    expect((await admin.call('POST', '/api/member/chat-channel/', { json: { token, company_id: CORP } })).status).toBe(201)
    const used = await admin.call('GET', `/api/member/chat-channel?token=${token}`)
    expect(await used.json()).toMatchObject({ fail_reason: 'token is used' })
    const unknown = await admin.call('GET', '/api/member/chat-channel?token=nope')
    expect(await unknown.json()).toMatchObject({ fail_reason: 'token is invalid' })
  })

  it('records the Hometax delegation consent', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    const current = await ctx.call(admin, 'GET', '/api/company/hometax/')
    expect(await current.json()).toMatchObject({ id: PLATFORM_SEED.hometaxDelegationId, status: 'requested' })
    const agreed = await ctx.call(admin, 'POST', '/api/company/hometax/', { json: { agreement_id: PLATFORM_SEED.hometaxDelegationId } })
    expect(await agreed.json()).toMatchObject({ status: 'agreed' })
    expect((await ctx.call(admin, 'POST', '/api/company/hometax', { json: { agreement_id: PLATFORM_SEED.hometaxDelegationId } })).status).toBe(409)
  })
})
