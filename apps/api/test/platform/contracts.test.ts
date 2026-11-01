import { describe, expect, it } from 'vitest'
import { queryOne } from '../../src/db/query'
import { CORP, createPlatformTestContext, pdfBytes, fileForm, USERS } from '../helpers/test-app'

const FEE = { revenue: 'sole_50m_to_100m', employee_number: 'under_10', business_type: 'etc', accounting_period: 'annual', diligent_business: 'no' } as const

describe('direct bookkeeping contract', () => {
  it('walks fee quote, identity, SMS, form and signature, then activates the tax plan on company registration', async () => {
    const ctx = await createPlatformTestContext()
    const guest = ctx.anonymous()
    const quote = await guest.call('POST', '/api/join/direct-contract/calculate-fee/', { json: FEE })
    expect(quote.status).toBe(200)
    const { contract_id: contractId, monthly_fee: monthlyFee } = (await quote.json()) as { contract_id: string; monthly_fee: number }
    expect(monthlyFee).toBeGreaterThan(0)

    expect((await guest.call('GET', `/api/join/direct-contract/${contractId}/1238145629/`)).status).toBe(200)
    expect((await guest.call('POST', `/api/join/direct-contract/send-sms/${contractId}/`, { json: { phone_number: '010-2222-3333' } })).status).toBe(202)
    const sms = ctx.messenger.outbox.findLast((message) => message.channel === 'sms' && message.template === 'direct_contract_verification')
    const code = sms?.data['code'] ?? ''
    expect((await guest.call('POST', `/api/join/direct-contract/verify-sms/${contractId}/`, { json: { phone_number: '01022223333', code: code === '000000' ? '111111' : '000000' } })).status).toBe(422)
    expect((await guest.call('POST', `/api/join/direct-contract/verify-sms/${contractId}/`, { json: { phone_number: '01022223333', code } })).status).toBe(200)
    const form = await guest.call('POST', `/api/join/direct-contract/request-contract-form/${contractId}/`, {
      json: { company_name: '계약상사', representative_name: '박대표', email: 'contract@example.com' },
    })
    expect(form.status).toBe(200)
    const signed = await guest.call('POST', `/api/join/direct-contract/sign-contract/${contractId}/`, {
      json: { signature: 'data:image/png;base64,AAAA', agreements: [{ code: 'bookkeeping_contract', is_agreed: true }] },
    })
    expect(signed.status).toBe(201)

    const owner = ctx.anonymous()
    await owner.call('POST', '/api/pre-signup/send-verification-email', { json: { email: 'contract@example.com' } })
    const mail = ctx.messenger.outbox.findLast((message) => message.channel === 'mail' && message.template === 'signup_verification')
    const token = mail?.channel === 'mail' ? mail.token : undefined
    await owner.call('POST', `/api/signup/user/email/${token}`, {
      json: { password: 'owner1234', confirm_password: 'owner1234', agreements: [{ code: 'service', is_agreed: true }, { code: 'privacy', is_agreed: true }] },
    })
    const created = await owner.call('POST', '/api/signup/company', { json: { name: '계약상사', business_number: '1238145629', business_type: 'individual' } })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    expect(queryOne<{ tax_plan: string | null }>(ctx.db, 'SELECT tax_plan FROM companies WHERE id = ?', [id])?.tax_plan).toBe('taxation')
  })
})

describe('company settings', () => {
  it('saves representatives and settlement fields through the sf settings path', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.login(`${USERS.admin}@example.com`)
    const patched = await admin.call('PATCH', `/api/settings/company/${CORP}/`, {
      json: { zip_code: '06236', address: '서울 강남구 테헤란로 1', payday_month: 'next', payday_day: '10', representatives: [{ role: 'boss', name: '이대표' }] },
    })
    expect(patched.status).toBe(200)
    const detail = (await (await admin.call('GET', `/api/company/${CORP}`)).json()) as Record<string, unknown>
    expect(JSON.stringify(detail)).toContain('이대표')
    expect(detail).toMatchObject({ zip_code: '06236', payday_month: 'next' })
  })

  it('uploads and downloads a company attachment by name', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    const uploaded = await ctx.call(admin, 'PUT', `/api/settings/company/${CORP}/attachments/`, { form: fileForm(pdfBytes('cms'), 'cms.pdf', { name: 'CMS동의서' }) })
    expect(uploaded.status).toBe(200)
    const meta = await ctx.call(admin, 'GET', `/api/settings/company/${CORP}/attachments?name=${encodeURIComponent('CMS동의서')}`)
    expect(await meta.json()).toMatchObject({ name: 'CMS동의서', file: { file_name: 'cms.pdf' } })
    const download = await ctx.call(admin, 'GET', `/api/settings/company/${CORP}/attachments/download?name=${encodeURIComponent('CMS동의서')}`)
    expect(new TextDecoder().decode(await download.arrayBuffer())).toContain('cms')
    const unknown = await ctx.call(admin, 'GET', `/api/settings/company/${CORP}/attachments?name=bogus`)
    expect(unknown.status).toBe(422)
  })
})
