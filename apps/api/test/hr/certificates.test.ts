import { describe, expect, it } from 'vitest'
import { insertEmployee } from '../../src/modules/hr/employees/employees.repository'
import type { EmployeeWrite } from '../../src/modules/hr/employees/employees.types'
import { CORP, createHrTestContext, fileForm, type HrTestContext, NOW, pngBytes, USERS } from '../helpers/test-app'

const BASE = `/api/company/${CORP}/employment`
const PUBLIC = '/api/employment/certificates'

type Context = HrTestContext & { admin: string; employeeId: number }

function employee(overrides: Partial<EmployeeWrite> = {}): EmployeeWrite {
  return {
    name: '김하나',
    english_name: null,
    registration_number_enc: null,
    registration_number_hash: null,
    identification_number_type: 'registration',
    birth_date: '1990-01-01',
    email: 'hana@example.com',
    phone: null,
    is_local: 1,
    nationality: null,
    visa: null,
    is_residence: 1,
    country_of_residence: 'KR',
    employee_number: null,
    department_id: null,
    position_id: null,
    join_date: '2024-03-01',
    work_code: null,
    is_rejoin: 0,
    ...overrides,
  }
}

async function setup(): Promise<Context> {
  const context = await createHrTestContext()
  const employeeId = insertEmployee(context.db, CORP, 'wage-salary', employee(), 'manual', USERS.admin, NOW)
  return { ...context, admin: await context.token(USERS.admin, CORP), employeeId }
}

async function issue(context: Context, overrides: Record<string, unknown> = {}): Promise<Response> {
  return context.call(context.admin, 'POST', `${BASE}/certificates`, {
    json: { template: 13, employment_type: 'wageemployee', employee_id: context.employeeId, field_values: { purpose: '은행 제출용' }, ...overrides },
  })
}

async function issued(context: Context): Promise<{ id: number; version: number; issue_number: string }> {
  const response = await issue(context)
  const body = (await response.json()) as { id: number; version: number; issue_number: string; status: string }
  expect(response.status, JSON.stringify(body)).toBe(201)
  expect(body.status).toBe('issued')
  return body
}

function lastLinkToken(context: HrTestContext): string {
  const url = String(context.notifier.outbox.at(-1)?.vars['certificate_url'] ?? '')
  const token = url.split('/').at(-1) ?? ''
  expect(token).not.toBe('')
  return token
}

describe('certificate issuance', () => {
  it('issues, sends and serves a certificate through its link', async () => {
    const context = await setup()
    const certificate = await issued(context)
    expect(certificate.issue_number).toBe('2026-0001')
    const documents = context.db.prepare("SELECT COUNT(*) AS n FROM employee_documents WHERE employee_id = ? AND source_type = 'certificate'").get(context.employeeId) as { n: number }
    expect(documents.n).toBe(1)

    expect((await context.call(context.admin, 'POST', `${BASE}/certificates/${certificate.id}/send`, { json: {} })).status).toBe(428)
    const sent = await context.call(context.admin, 'POST', `${BASE}/certificates/${certificate.id}/send`, { ifMatch: certificate.version, json: {} })
    const sentBody = (await sent.json()) as { status: string; sent_to_email: string; link_expires_at: string }
    expect(sent.status, JSON.stringify(sentBody)).toBe(200)
    expect(sentBody).toMatchObject({ status: 'sent', sent_to_email: 'hana@example.com', link_expires_at: '2026-12-01T09:00:00.000+09:00' })
    const token = lastLinkToken(context)

    const summary = (await (await context.anonymous('GET', `${PUBLIC}/${token}/summary`)).json()) as Record<string, unknown>
    expect(summary).toMatchObject({ status: 'sent', employee_name: '김*나', title: '재직증명서', issue_number: '2026-0001' })

    expect(((await (await context.anonymous('GET', `${PUBLIC}/${token}/download`)).json()) as { code: string }).code).toBe('SIGNER_SESSION_REQUIRED')
    const failed = await context.anonymous('POST', `${PUBLIC}/${token}/verify`, { json: { name: '김하나', birth_date: '1999-09-09' } })
    expect(failed.status).toBe(403)
    expect(((await failed.json()) as { remaining_attempts: number }).remaining_attempts).toBe(4)
    const verified = await context.anonymous('POST', `${PUBLIC}/${token}/verify`, { json: { name: '김하나', birth_date: '1990-01-01' } })
    const { session_token: session } = (await verified.json()) as { session_token: string }
    const download = await context.anonymous('GET', `${PUBLIC}/${token}/download`, { headers: { 'X-Certificate-Session': session } })
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toContain('application/pdf')
  })

  it('marks failed deliveries and retries with another address', async () => {
    const context = await setup()
    const certificate = await issued(context)
    const failed = await context.call(context.admin, 'POST', `${BASE}/certificates/${certificate.id}/send`, { ifMatch: certificate.version, json: { email: 'x@fail.invalid' } })
    const failedBody = (await failed.json()) as { status: string; version: number; send_error: string | null }
    expect(failedBody.status).toBe('send_failed')
    expect(failedBody.send_error).not.toBeNull()
    expect((await context.call(context.admin, 'POST', `${BASE}/certificates/${certificate.id}/send`, { ifMatch: certificate.version, json: {} })).status).toBe(412)
    const retried = await context.call(context.admin, 'POST', `${BASE}/certificates/${certificate.id}/send`, { ifMatch: failedBody.version, json: {} })
    expect(((await retried.json()) as { status: string }).status).toBe('sent')
  })

  it('refuses a retirement certificate before the employee has left', async () => {
    const context = await setup()
    const response = await issue(context, { template: 15 })
    expect(response.status).toBe(422)
    expect(await issue(context, { template: 1 }).then((result) => result.status)).toBe(422)
  })

  it('counts by status and downloads several certificates as a ZIP', async () => {
    const context = await setup()
    const first = await issued(context)
    const second = await issued(context)
    expect(second.issue_number).toBe('2026-0002')
    await context.call(context.admin, 'POST', `${BASE}/certificates/${first.id}/send`, { ifMatch: first.version, json: {} })
    const counts = (await (await context.call(context.admin, 'GET', `${BASE}/certificates/count-by-status`)).json()) as Record<string, number>
    expect(counts).toEqual({ all: 2, issued: 1, sending: 0, sent: 1, send_failed: 0 })
    const list = (await (await context.call(context.admin, 'GET', `${BASE}/certificates?status=sent`)).json()) as { count: number }
    expect(list.count).toBe(1)

    const single = await context.call(context.admin, 'POST', `${BASE}/certificates/download`, { json: { ids: [first.id] } })
    expect(single.headers.get('content-type')).toContain('application/pdf')
    const zip = await context.call(context.admin, 'POST', `${BASE}/certificates/download`, { json: { ids: [first.id, second.id] } })
    expect(zip.status).toBe(200)
    expect(zip.headers.get('content-type')).toContain('application/zip')
    expect([...new Uint8Array(await zip.arrayBuffer()).slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('stamps the chosen company seal and invalidates the link on delete', async () => {
    const context = await setup()
    const sealResponse = await context.call(context.admin, 'POST', `${BASE}/settings/company-seals`, { form: fileForm(pngBytes('seal'), 'seal.png') })
    const seal = ((await sealResponse.json()) as { id: number }).id
    const response = await issue(context, { company_seal: seal })
    const certificate = (await response.json()) as { id: number; version: number; company_seal: number }
    expect(certificate.company_seal).toBe(seal)
    await context.call(context.admin, 'POST', `${BASE}/certificates/${certificate.id}/send`, { ifMatch: certificate.version, json: {} })
    const token = lastLinkToken(context)
    expect((await context.call(context.admin, 'DELETE', `${BASE}/certificates/${certificate.id}`)).status).toBe(204)
    expect((await context.anonymous('GET', `${PUBLIC}/${token}/summary`)).status).toBe(404)
  })

  it('reports expired links as closed', async () => {
    const context = await setup()
    const certificate = await issued(context)
    await context.call(context.admin, 'POST', `${BASE}/certificates/${certificate.id}/send`, { ifMatch: certificate.version, json: {} })
    const token = lastLinkToken(context)
    context.db.prepare("UPDATE certificate_issuances SET token_expires_at = '2026-10-01T00:00:00+09:00' WHERE id = ?").run(certificate.id)
    expect(((await (await context.anonymous('GET', `${PUBLIC}/${token}/summary`)).json()) as { status: string }).status).toBe('expired')
    expect((await context.anonymous('POST', `${PUBLIC}/${token}/verify`, { json: { name: '김하나' } })).status).toBe(410)
  })

  it('rejects members without the certificate menu', async () => {
    const context = await setup()
    const member = await context.token(USERS.plainMember, CORP)
    expect((await context.call(member, 'GET', `${BASE}/certificates`)).status).toBe(403)
  })
})
