import { describe, expect, it } from 'vitest'
import { insertEmployee } from '../../src/modules/hr/employees/employees.repository'
import type { EmployeeWrite } from '../../src/modules/hr/employees/employees.types'
import { resolveHrAdapters } from '../../src/modules/hr/adapters/hr-adapters'
import { expireOverdueESignRequests } from '../../src/modules/hr/e-sign/e-sign-requests.service'
import type { HrContext } from '../../src/modules/hr/shared/hr-context.types'
import { CORP, createHrTestContext, fileForm, type HrTestContext, NOW, pngBytes, USERS } from '../helpers/test-app'

const BASE = `/api/company/${CORP}/employment`
const SIGNER_BASE = '/api/employment/e-sign'

const CONTRACT_VALUES = { join_date: '2026-11-02', contract_start_date: '2026-11-02', job_description: '개발', monthly_wage: 3_000_000 }

function employee(overrides: Partial<EmployeeWrite> = {}): EmployeeWrite {
  return {
    name: '김하나',
    english_name: null,
    registration_number_enc: null,
    registration_number_hash: null,
    identification_number_type: 'registration',
    birth_date: '1990-01-01',
    email: 'hana@example.com',
    phone: '010-1234-5678',
    is_local: 1,
    nationality: null,
    visa: null,
    is_residence: 1,
    country_of_residence: 'KR',
    employee_number: null,
    department_id: null,
    position_id: null,
    join_date: '2026-11-02',
    work_code: null,
    is_rejoin: 0,
    ...overrides,
  }
}

async function setup(options: { payrollPlan?: boolean } = {}): Promise<HrTestContext & { admin: string }> {
  const context = await createHrTestContext(options)
  return { ...context, admin: await context.token(USERS.admin, CORP) }
}

async function uploadSeal(context: HrTestContext & { admin: string }): Promise<number> {
  const response = await context.call(context.admin, 'POST', `${BASE}/settings/company-seals`, { form: fileForm(pngBytes('seal'), 'seal.png', { source: 'upload' }) })
  expect(response.status).toBe(201)
  return ((await response.json()) as { id: number }).id
}

function requestBody(seal: number, recipient: Record<string, unknown>, send = true): Record<string, unknown> {
  return {
    templates: [{ template_id: 1 }],
    workplace_size: 'gte5',
    wage_type: 'monthly',
    recipient: { employment_type: 'wageemployee', ...recipient },
    field_values: { '0': CONTRACT_VALUES },
    company_seal: seal,
    send,
  }
}

function lastSigningToken(context: HrTestContext): string {
  const message = context.notifier.outbox.at(-1)
  const url = String(message?.vars['signing_url'] ?? '')
  const token = url.split('/').at(-1) ?? ''
  expect(token).not.toBe('')
  return token
}

async function createSent(context: HrTestContext & { admin: string }, recipient: Record<string, unknown>): Promise<{ id: number; version: number; token: string }> {
  const seal = await uploadSeal(context)
  const response = await context.call(context.admin, 'POST', `${BASE}/e-sign-requests`, { json: requestBody(seal, recipient) })
  const body = (await response.json()) as { id: number; status: string; version: number }
  expect(response.status, JSON.stringify(body)).toBe(201)
  expect(body.status).toBe('pending')
  return { id: body.id, version: body.version, token: lastSigningToken(context) }
}

async function verify(context: HrTestContext, token: string, claim: Record<string, unknown>): Promise<Response> {
  return context.anonymous('POST', `${SIGNER_BASE}/${token}/verify`, { json: claim })
}

async function session(context: HrTestContext, token: string, claim: Record<string, unknown>): Promise<string> {
  const response = await verify(context, token, claim)
  expect(response.status).toBe(200)
  return ((await response.json()) as { session_token: string }).session_token
}

function jobContext(context: HrTestContext): HrContext {
  const deps = { db: context.db, clock: context.clock, storage: context.storage, cipher: context.cipher, jwtSecret: '', taxTermsVersion: '', maxUploadBytes: 0, notifier: context.notifier }
  return { deps, adapters: resolveHrAdapters(deps) }
}

function count(context: HrTestContext, sql: string, ...params: (string | number)[]): number {
  return (context.db.prepare(sql).get(...params) as { n: number }).n
}

describe('e-sign settings', () => {
  it('limits company seals to five', async () => {
    const context = await setup()
    for (let index = 0; index < 5; index += 1) await uploadSeal(context)
    const response = await context.call(context.admin, 'POST', `${BASE}/settings/company-seals`, { form: fileForm(pngBytes('six'), 'six.png') })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { code: string }).code).toBe('SEAL_LIMIT_EXCEEDED')
    const list = (await (await context.call(context.admin, 'GET', `${BASE}/settings/company-seals`)).json()) as { id: number; image: string }[]
    expect(list).toHaveLength(5)
    const image = await context.call(context.admin, 'GET', list[0]?.image ?? '')
    expect(image.status).toBe(200)
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(pngBytes('seal'))
    expect((await context.call(context.admin, 'DELETE', `${BASE}/settings/company-seals/${list[0]?.id}`)).status).toBe(204)
    expect((await uploadSeal(context)) > 0).toBe(true)
  })

  it('stores up to three notification recipients', async () => {
    const context = await setup()
    const recipient = { name: '담당자', phone: '010-0000-0000' }
    const tooMany = await context.call(context.admin, 'PUT', `${BASE}/settings/e-sign-noti-recipients`, { json: [recipient, recipient, recipient, recipient] })
    expect(tooMany.status).toBe(422)
    const saved = await context.call(context.admin, 'PUT', `${BASE}/settings/e-sign-noti-recipients`, { json: { recipients: [recipient] } })
    expect(saved.status).toBe(200)
    const list = (await (await context.call(context.admin, 'GET', `${BASE}/settings/e-sign-noti-recipients`)).json()) as { name: string }[]
    expect(list.map((row) => row.name)).toEqual(['담당자'])
  })

  it('overrides a base template per company and can turn it off', async () => {
    const context = await setup()
    const patched = await context.call(context.admin, 'PATCH', `${BASE}/settings/e-sign-templates/1`, { json: { title: '우리 회사 근로계약서', is_active: false } })
    expect(patched.status).toBe(200)
    const detail = (await (await context.call(context.admin, 'GET', `${BASE}/settings/e-sign-templates/1`)).json()) as Record<string, unknown>
    expect(detail['title']).toBe('우리 회사 근로계약서')
    expect(detail['is_active']).toBe(false)
    expect(detail['template_type']).toBe('company_e_sign_template')
    const list = (await (await context.call(context.admin, 'GET', `${BASE}/settings/e-sign-templates?is_certificate=true`)).json()) as { results: { is_certificate: boolean }[] }
    expect(list.results.length).toBeGreaterThan(0)
    expect(list.results.every((row) => row.is_certificate)).toBe(true)
    const seal = await uploadSeal(context)
    const send = await context.call(context.admin, 'POST', `${BASE}/e-sign-requests`, { json: requestBody(seal, { name: '박둘', email: 'dul@example.com' }) })
    expect(send.status).toBe(422)
  })
})

describe('e-sign request lifecycle', () => {
  it('signs a contract for a new worker and records the employee, contracts and document', async () => {
    const context = await setup()
    const sent = await createSent(context, { name: '박둘', email: 'dul@example.com', birth_date: '1995-05-05' })
    const summary = (await (await context.anonymous('GET', `${SIGNER_BASE}/${sent.token}/summary`)).json()) as Record<string, unknown>
    expect(summary).toMatchObject({ status: 'pending', recipient_name: '박*', requires_birth_date: true, expired: false })

    const missing = await context.anonymous('GET', `${SIGNER_BASE}/${sent.token}/documents`)
    expect(((await missing.json()) as { code: string }).code).toBe('SIGNER_SESSION_REQUIRED')
    const wrong = await context.anonymous('GET', `${SIGNER_BASE}/${sent.token}/documents`, { headers: { 'X-ESign-Session': 'nope' } })
    expect(((await wrong.json()) as { code: string }).code).toBe('SIGNER_SESSION_INVALID')

    const signer = await session(context, sent.token, { name: '박둘', birth_date: '1995-05-05' })
    const headers = { 'X-ESign-Session': signer }
    const detail = (await (await context.call(context.admin, 'GET', `${BASE}/e-sign-requests/${sent.id}`)).json()) as { status: string }
    expect(detail.status).toBe('in_progress')

    const documents = (await (await context.anonymous('GET', `${SIGNER_BASE}/${sent.token}/documents`, { headers })).json()) as { signer_fields: string[] }[]
    expect(documents[0]?.signer_fields).toContain('signer_address')
    const sealResponse = await context.anonymous('POST', `${SIGNER_BASE}/${sent.token}/seals`, { headers, form: fileForm(pngBytes('sign'), 'sign.png') })
    expect(sealResponse.status).toBe(201)
    const sealId = ((await sealResponse.json()) as { id: number }).id
    const signerSeals = (await (await context.anonymous('GET', `${SIGNER_BASE}/${sent.token}/seals`, { headers })).json()) as unknown[]
    expect(signerSeals).toHaveLength(1)

    const complete = await context.anonymous('POST', `${SIGNER_BASE}/${sent.token}/complete`, {
      headers,
      json: { documents: [{ index: 0, seal_id: sealId, field_values: { signer_address: '서울' } }] },
    })
    expect(complete.status).toBe(200)
    const completed = (await complete.json()) as { status: string; employee_id: number | null }
    expect(completed.status).toBe('completed')
    expect(completed.employee_id).not.toBeNull()

    const workerPdf = await context.anonymous('GET', `${SIGNER_BASE}/${sent.token}/download`, { headers })
    expect(workerPdf.status).toBe(200)
    expect(workerPdf.headers.get('content-type')).toContain('application/pdf')
    const adminPdf = await context.call(context.admin, 'GET', `${BASE}/e-sign-requests/${sent.id}/download`)
    expect(adminPdf.status).toBe(200)

    const employeeId = completed.employee_id ?? 0
    expect(count(context, 'SELECT COUNT(*) AS n FROM employees WHERE company_id = ? AND id = ?', CORP, employeeId)).toBe(1)
    expect(count(context, 'SELECT COUNT(*) AS n FROM employee_work_contracts WHERE employee_id = ?', employeeId)).toBe(1)
    expect(count(context, 'SELECT COUNT(*) AS n FROM employee_payroll_contracts WHERE employee_id = ?', employeeId)).toBe(1)
    expect(count(context, "SELECT COUNT(*) AS n FROM employee_documents WHERE employee_id = ? AND source_type = 'e_sign'", employeeId)).toBe(1)

    const again = await context.anonymous('POST', `${SIGNER_BASE}/${sent.token}/complete`, { headers, json: { documents: [{ index: 0, seal_id: sealId }] } })
    expect(again.status).toBe(410)
    expect(((await again.json()) as { code: string }).code).toBe('SIGNING_CLOSED')
  })

  it('links the signed contract to an existing employee', async () => {
    const context = await setup()
    const employeeId = insertEmployee(context.db, CORP, 'wage-salary', employee(), 'manual', USERS.admin, NOW)
    const before = count(context, 'SELECT COUNT(*) AS n FROM employees WHERE company_id = ?', CORP)
    const sent = await createSent(context, { employee_id: employeeId, name: '김하나', email: 'hana@example.com' })
    const signer = await session(context, sent.token, { name: '김하나', birth_date: '1990-01-01' })
    const sealResponse = await context.anonymous('POST', `${SIGNER_BASE}/${sent.token}/seals`, { headers: { 'X-ESign-Session': signer }, form: fileForm(pngBytes('s'), 's.png') })
    const sealId = ((await sealResponse.json()) as { id: number }).id
    const complete = await context.anonymous('POST', `${SIGNER_BASE}/${sent.token}/complete`, {
      headers: { 'X-ESign-Session': signer },
      json: { documents: [{ index: 0, seal_id: sealId }] },
    })
    expect(((await complete.json()) as { employee_id: number }).employee_id).toBe(employeeId)
    expect(count(context, 'SELECT COUNT(*) AS n FROM employees WHERE company_id = ?', CORP)).toBe(before)
  })

  it('locks identity verification after five failures', async () => {
    const context = await setup()
    const sent = await createSent(context, { name: '박둘', email: 'dul@example.com', birth_date: '1995-05-05' })
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await verify(context, sent.token, { name: '박둘', birth_date: '2000-01-01' })
      expect(response.status).toBe(403)
      expect(((await response.json()) as { remaining_attempts: number }).remaining_attempts).toBe(5 - attempt)
    }
    const locked = await verify(context, sent.token, { name: '박둘', birth_date: '1995-05-05' })
    expect(locked.status).toBe(429)
    expect(((await locked.json()) as { code: string }).code).toBe('IDENTITY_VERIFICATION_LOCKED')
  })

  it('rejects unknown signing tokens', async () => {
    const context = await setup()
    const response = await context.anonymous('GET', `${SIGNER_BASE}/unknown-token/summary`)
    expect(response.status).toBe(404)
    expect(((await response.json()) as { code: string }).code).toBe('SIGNING_TOKEN_INVALID')
  })

  it('moves to send_failed when delivery fails and can be reverted to a draft', async () => {
    const context = await setup()
    const seal = await uploadSeal(context)
    const created = await context.call(context.admin, 'POST', `${BASE}/e-sign-requests`, { json: requestBody(seal, { name: '박둘', email: 'x@fail.invalid' }) })
    const body = (await created.json()) as { id: number; status: string; version: number }
    expect(body.status).toBe('send_failed')
    expect((await context.call(context.admin, 'POST', `${BASE}/e-sign-requests/${body.id}/revert-to-draft`)).status).toBe(428)
    expect((await context.call(context.admin, 'POST', `${BASE}/e-sign-requests/${body.id}/revert-to-draft`, { ifMatch: body.version + 5 })).status).toBe(412)
    const reverted = await context.call(context.admin, 'POST', `${BASE}/e-sign-requests/${body.id}/revert-to-draft`, { ifMatch: body.version })
    expect(reverted.status).toBe(200)
    const draft = (await reverted.json()) as { status: string; version: number }
    expect(draft.status).toBe('draft')
    expect(reverted.headers.get('ETag')).toBe(`"${draft.version}"`)
    await context.call(context.admin, 'PATCH', `${BASE}/e-sign-requests/${body.id}`, { json: { recipient: { employment_type: 'wageemployee', name: '박둘', email: 'dul@example.com' } } })
    const resend = await context.call(context.admin, 'POST', `${BASE}/e-sign-requests/${body.id}/send`, { ifMatch: draft.version, json: {} })
    expect(resend.status).toBe(200)
    expect(((await resend.json()) as { status: string }).status).toBe('pending')
  })

  it('cancels a pending request, closing its link, and guards deletion by status', async () => {
    const context = await setup()
    const sent = await createSent(context, { name: '박둘', email: 'dul@example.com' })
    const blocked = await context.call(context.admin, 'DELETE', `${BASE}/e-sign-requests/${sent.id}`)
    expect(blocked.status).toBe(409)
    const cancelled = await context.call(context.admin, 'POST', `${BASE}/e-sign-requests/${sent.id}/cancel`, { ifMatch: sent.version })
    expect(((await cancelled.json()) as { status: string }).status).toBe('cancelled')
    const closed = await verify(context, sent.token, { name: '박둘' })
    expect(closed.status).toBe(410)
    expect((await context.call(context.admin, 'DELETE', `${BASE}/e-sign-requests/${sent.id}`)).status).toBe(204)
    expect((await context.call(context.admin, 'GET', `${BASE}/e-sign-requests/${sent.id}`)).status).toBe(404)
  })

  it('voids a completed request', async () => {
    const context = await setup()
    const sent = await createSent(context, { name: '박둘', email: 'dul@example.com' })
    const signer = await session(context, sent.token, { name: '박둘' })
    const sealResponse = await context.anonymous('POST', `${SIGNER_BASE}/${sent.token}/seals`, { headers: { 'X-ESign-Session': signer }, form: fileForm(pngBytes('s'), 's.png') })
    const sealId = ((await sealResponse.json()) as { id: number }).id
    await context.anonymous('POST', `${SIGNER_BASE}/${sent.token}/complete`, { headers: { 'X-ESign-Session': signer }, json: { documents: [{ index: 0, seal_id: sealId }] } })
    const detail = await context.call(context.admin, 'GET', `${BASE}/e-sign-requests/${sent.id}`)
    const version = ((await detail.json()) as { version: number }).version
    const voided = await context.call(context.admin, 'POST', `${BASE}/e-sign-requests/${sent.id}/void`, { ifMatch: version })
    expect(voided.status).toBe(200)
    expect(((await voided.json()) as { status: string }).status).toBe('voided')
  })

  it('expires overdue requests lazily and through the job', async () => {
    const context = await setup()
    const first = await createSent(context, { name: '박둘', email: 'dul@example.com' })
    const second = await createSent(context, { name: '최셋', email: 'set@example.com' })
    context.db.prepare("UPDATE esign_requests SET due_date = '2026-10-01' WHERE id IN (?, ?)").run(first.id, second.id)
    const list = (await (await context.call(context.admin, 'GET', `${BASE}/e-sign-requests?status=expired`)).json()) as { count: number }
    expect(list.count).toBe(2)
    expect(await expireOverdueESignRequests(jobContext(context), null)).toBe(0)
    const third = await createSent(context, { name: '정넷', email: 'net@example.com' })
    context.db.prepare("UPDATE esign_requests SET due_date = '2026-10-01' WHERE id = ?").run(third.id)
    expect(await expireOverdueESignRequests(jobContext(context), null)).toBe(1)
    const summary = (await (await context.anonymous('GET', `${SIGNER_BASE}/${first.token}/summary`)).json()) as { expired: boolean }
    expect(summary.expired).toBe(true)
  })
})

describe('e-sign access', () => {
  it('rejects members without the e-sign menu', async () => {
    const context = await setup()
    const member = await context.token(USERS.plainMember, CORP)
    const response = await context.call(member, 'GET', `${BASE}/e-sign-requests`)
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe('PERMISSION_DENIED')
  })

  it('requires the payroll plan', async () => {
    const context = await setup({ payrollPlan: false })
    const response = await context.call(context.admin, 'GET', `${BASE}/e-sign-requests`)
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe('ENTITLEMENT_REQUIRED')
  })

  it('keeps demo accounts read-only', async () => {
    const context = await setup()
    const demo = await context.token(USERS.demo, CORP)
    expect((await context.call(demo, 'GET', `${BASE}/e-sign-requests`)).status).toBe(200)
    const response = await context.call(demo, 'POST', `${BASE}/e-sign-requests`, { json: requestBody(1, { name: '박둘', email: 'dul@example.com' }, false) })
    expect(((await response.json()) as { code: string }).code).toBe('DEMO_READ_ONLY')
  })
})
