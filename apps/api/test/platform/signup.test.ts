import { describe, expect, it } from 'vitest'
import { execute, queryOne } from '../../src/db/query'
import type { PlatformTestContext, SessionAgent } from '../helpers/test-app'
import { createPlatformTestContext } from '../helpers/test-app'

const SIGNUP_AGREEMENTS = [
  { code: 'service', is_agreed: true },
  { code: 'privacy', is_agreed: true },
  { code: 'marketing', is_agreed: false },
]

async function signUp(ctx: PlatformTestContext, email: string): Promise<SessionAgent> {
  const agent = ctx.anonymous()
  expect((await agent.call('POST', '/api/pre-signup/send-verification-email/', { json: { email } })).status).toBe(202)
  const mail = ctx.messenger.outbox.findLast((message) => message.channel === 'mail' && message.template === 'signup_verification' && message.to === email)
  const token = mail?.channel === 'mail' ? mail.token : undefined
  const response = await agent.call('POST', `/api/signup/user/email/${token}/`, {
    json: { password: 'owner1234', confirm_password: 'owner1234', name: '김대표', agreements: SIGNUP_AGREEMENTS },
  })
  expect(response.status).toBe(201)
  return agent
}

describe('signup to company registration', () => {
  it('creates the account, records the terms and registers the company as its system admin', async () => {
    const ctx = await createPlatformTestContext()
    const pre = ctx.anonymous()
    expect(await (await pre.call('GET', '/api/pre-signup/check-email-duplicate/?email=owner@example.com')).json()).toEqual({ is_duplicated: false })
    const check = (await (await pre.call('GET', '/api/pre-signup/check/business_number/?business_number=123-81-45615')).json()) as Record<string, unknown>
    expect(check).toMatchObject({ business_number: '1238145615', is_valid: true, is_duplicated: false })

    const agent = await signUp(ctx, 'owner@example.com')
    const terms = (await (await agent.call('GET', '/api/user/me/term-agreements/?purpose=signup')).json()) as { code: string; needs_consent: boolean }[]
    expect(terms.map((term) => [term.code, term.needs_consent])).toEqual([
      ['service', false],
      ['privacy', false],
      ['marketing', false],
    ])

    const created = await agent.call('POST', '/api/signup/company/', {
      json: { name: '새회사', business_number: '1238145615', business_type: 'individual', representative_name: '김대표' },
    })
    expect(created.status).toBe(201)
    const company = (await created.json()) as { id: string }
    const me = (await (await agent.call('GET', '/api/user/me')).json()) as { companies: { id: string; is_system_admin: boolean; tax_plan: string | null }[] }
    expect(me.companies).toEqual([expect.objectContaining({ id: company.id, is_system_admin: true, tax_plan: null })])
    expect((await agent.call('GET', `/api/company/${company.id}/user`)).status).toBe(200)

    const again = await agent.call('POST', '/api/signup/company', { json: { name: '중복', business_number: '1238145615', business_type: 'individual' } })
    expect(again.status).toBe(409)
  })

  it('enforces the password policy and the required terms', async () => {
    const ctx = await createPlatformTestContext()
    const agent = ctx.anonymous()
    await agent.call('POST', '/api/pre-signup/send-verification-email', { json: { email: 'weak@example.com' } })
    const mail = ctx.messenger.outbox.findLast((message) => message.channel === 'mail' && message.template === 'signup_verification')
    const token = mail?.channel === 'mail' ? mail.token : undefined
    const lettersOnly = await agent.call('POST', `/api/signup/user/email/${token}`, {
      json: { password: 'onlyletters', confirm_password: 'onlyletters', agreements: SIGNUP_AGREEMENTS },
    })
    expect(lettersOnly.status).toBe(422)
    const missingTerms = await agent.call('POST', `/api/signup/user/email/${token}`, {
      json: { password: 'good1234', confirm_password: 'good1234', agreements: [{ code: 'service', is_agreed: true }] },
    })
    expect(missingTerms.status).toBe(422)
  })

  it('asks again when a required term gets a new version', async () => {
    const ctx = await createPlatformTestContext()
    const agent = await signUp(ctx, 'again@example.com')
    execute(
      ctx.db,
      `INSERT INTO terms (code, purpose_code, title, content_url, version, is_required, audience, effective_from, created_at)
       VALUES ('privacy', 'signup', '개인정보 수집·이용 동의', '/static/terms/privacy-v2.html', '2026-10', 1, 'all', '2026-10-01', ?)`,
      [ctx.clock.now()],
    )
    const terms = (await (await agent.call('GET', '/api/user/me/term-agreements?purpose=signup')).json()) as { code: string; version: string; needs_consent: boolean }[]
    expect(terms.find((term) => term.code === 'privacy')).toMatchObject({ version: '2026-10', needs_consent: true })
    const patched = await agent.call('PATCH', '/api/user/me/term-agreements?purpose=signup', { json: { agreements: [{ code: 'privacy', is_agreed: true }] } })
    const after = (await patched.json()) as { code: string; needs_consent: boolean }[]
    expect(after.every((term) => !term.needs_consent)).toBe(true)
  })

  it('syncs tax term consent into the gate the tax menus check', async () => {
    const ctx = await createPlatformTestContext()
    const agent = await ctx.login('u-ind@example.com')
    execute(ctx.db, "DELETE FROM term_agreements WHERE user_id = 'u-ind'")
    await agent.call('PATCH', '/api/user/me/term-agreements?purpose=tax', { json: { agreements: [{ code: 'tax_service', is_agreed: true }] } })
    const row = queryOne<{ version: string }>(ctx.db, "SELECT version FROM term_agreements WHERE user_id = 'u-ind' AND term_type = 'tax'")
    expect(row?.version).toBe('2026-01')
  })
})

describe('guest agreements and leads', () => {
  it('stores consultation consent by email and creates the lead', async () => {
    const ctx = await createPlatformTestContext()
    const guest = ctx.anonymous()
    const saved = await guest.call('POST', '/public/api/terms/agreements', {
      json: {
        email: 'guest@example.com',
        purpose_code: 'consulting',
        agreements: [
          { code: 'consult_privacy', is_agreed: true },
          { code: 'consult_third_party', is_agreed: true },
        ],
      },
    })
    expect(saved.status).toBe(201)
    const lead = await guest.call('POST', '/public/api/consult', {
      json: {
        name: '홍길동',
        phone: '010-1234-5678',
        email: 'guest@example.com',
        label_ids: [1],
        consulting_privacy_date: '2026-11-01',
        consulting_third_party_date: '2026-11-01',
      },
    })
    expect(lead.status).toBe(201)
    expect(ctx.messenger.outbox.some((message) => message.channel === 'sms' && message.to === '01012345678')).toBe(true)

    expect((await guest.call('POST', '/api/lead/online?timestamp=1730419200', { json: { lead_type: 'biz', name: '홍길동' } })).status).toBe(201)
    expect((await guest.call('POST', '/api/lead/online?timestamp=1730419200', { json: { lead_type: 'biz' } })).status).toBe(409)
    const patched = await guest.call('PATCH', '/api/lead/online?timestamp=1730419200', { json: { revenue: '1억' } })
    expect(await patched.json()).toMatchObject({ lead_type: 'biz', name: '홍길동', revenue: '1억' })
  })
})
