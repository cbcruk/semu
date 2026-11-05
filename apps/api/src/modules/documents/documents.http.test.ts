import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from './shared/http-test-support.ts'

const EMPLOYMENT_CONTRACT = 'est_01JBQ0000000000000000000C1'
const EMPLOYMENT_CERTIFICATE = 'est_01JBQ0000000000000000000E1'
const RETIREMENT_CERTIFICATE = 'est_01JBQ0000000000000000000E3'
const SEAL = 'sel_01JBQ000000000000000000001'

let app: TestApp

beforeEach(() => {
  app = startTestApp()
})

afterEach(async () => {
  await app.dispose()
})

async function hire(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await app.json('POST', '/employees', {
    body: {
      kind: 'WAGE',
      name: '홍길동',
      registrationNumber: '900101-1234567',
      joinDate: '2024-01-02',
      email: 'hong@example.com',
      ...overrides,
    },
  })
  return created.body.id
}

async function draft(employeeId: string, overrides: Record<string, unknown> = {}) {
  return app.json('POST', '/esign-requests', {
    body: {
      title: '2026 근로계약',
      recipient: { employeeId },
      templateIds: [EMPLOYMENT_CONTRACT],
      fieldValues: { '0': { workPlace: '본사', jobDescription: '회계' } },
      companySealId: SEAL,
      ...overrides,
    },
  })
}

function tokenOf(signingUrl: string): string {
  return signingUrl.slice(signingUrl.lastIndexOf('/') + 1)
}

describe('e-sign requests', () => {
  it('fills the recipient from HR and lists only draft actions', async () => {
    const employeeId = await hire()
    const created = await draft(employeeId)

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      allowedActions: ['UPDATE', 'DELETE', 'SEND'],
      recipient: { employeeId, name: '홍길동', email: 'hong@example.com', isForeigner: false },
    })
  })

  it('collects every send violation', async () => {
    const employeeId = await hire({ email: undefined })
    const created = await draft(employeeId, { fieldValues: {}, companySealId: undefined })
    const sent = await app.json('POST', `/esign-requests/${created.body.id}:send`)

    expect(sent.status).toBe(422)
    expect(sent.body.violations.map((violation: { field: string }) => violation.field)).toEqual([
      'recipient.email',
      'fieldValues.0.workPlace',
      'fieldValues.0.jobDescription',
      'companySealId',
    ])
  })

  it('sends, refuses edits after sending and cancels', async () => {
    const employeeId = await hire()
    const created = await draft(employeeId)
    const sent = await app.json('POST', `/esign-requests/${created.body.id}:send`, { ifMatch: '"1"' })

    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ status: 'PENDING', allowedActions: ['CANCEL'], version: 2 })
    expect(sent.body.signingUrl).toMatch(/^https:\/\/app\.semu\.kr\/esign\//)

    const edit = await app.json('PUT', `/esign-requests/${created.body.id}`, {
      body: { title: '수정', recipient: { employeeId }, templateIds: [EMPLOYMENT_CONTRACT] },
    })
    expect(edit.status).toBe(409)
    expect(edit.body).toMatchObject({ code: 'ESIGN_REQUEST_TRANSITION_INVALID', currentStatus: 'PENDING' })

    const canceled = await app.json('POST', `/esign-requests/${created.body.id}:cancel`)
    expect(canceled.body).toMatchObject({ status: 'CANCELED' })

    const resent = await app.json('POST', `/esign-requests/${created.body.id}:resend`)
    expect(resent.body).toMatchObject({ status: 'PENDING' })
  })

  it("refuses another company's seal", async () => {
    const created = await app.json('POST', '/esign-requests', {
      token: 'other-company',
      body: {
        title: '2026 근로계약',
        recipient: { name: '김다른', email: 'kim@example.com' },
        templateIds: [EMPLOYMENT_CONTRACT],
        companySealId: SEAL,
      },
    })

    expect(created.status).toBe(422)
    expect(created.body).toMatchObject({
      code: 'ESIGN_REQUEST_INVALID',
      violations: [{ field: 'companySealId', code: 'NOT_FOUND' }],
    })
  })

  it('marks a failed mail as SEND_FAILED', async () => {
    const employeeId = await hire({ email: 'fail@example.com' })
    const created = await draft(employeeId)
    const sent = await app.json('POST', `/esign-requests/${created.body.id}:send`)

    expect(sent.body).toMatchObject({ status: 'SEND_FAILED' })
  })
})

describe('company seals', () => {
  const register = (token: string, name = '직인') =>
    app.json('POST', '/company-seals', {
      token,
      body: { name, source: 'UPLOAD', imageFileId: 'fle_01JBQ000000000000000000002' },
    })

  it('lets another company register its own seal and send with it', async () => {
    const seal = await register('other-company')
    expect(seal.status).toBe(201)

    const listed = await app.json('GET', '/company-seals', { token: 'other-company' })
    expect(listed.body.items.map((item: { id: string }) => item.id)).toEqual([seal.body.id])

    const created = await app.json('POST', '/esign-requests', {
      token: 'other-company',
      body: {
        title: '2026 근로계약',
        recipient: { name: '김다른', email: 'kim@example.com' },
        templateIds: [EMPLOYMENT_CONTRACT],
        fieldValues: {
          '0': { workPlace: '본사', jobDescription: '회계', employeeName: '김다른', startDate: '2026-12-01' },
        },
        companySealId: seal.body.id,
      },
    })
    expect(created.status).toBe(201)
    const sent = await app.json('POST', `/esign-requests/${created.body.id}:send`, { token: 'other-company' })
    expect(sent.body).toMatchObject({ status: 'PENDING', companySealId: seal.body.id })
  })

  it("does not show or delete another company's seal", async () => {
    const listed = await app.json('GET', '/company-seals', { token: 'other-company' })
    const removed = await app.json('DELETE', `/company-seals/${SEAL}`, { token: 'other-company' })

    expect(listed.body.items).toEqual([])
    expect(removed).toMatchObject({ status: 404, body: { code: 'COMPANY_SEAL_NOT_FOUND' } })
  })

  it('allows five active seals and frees a slot on delete', async () => {
    const created = []
    for (let index = 0; index < 5; index += 1) created.push(await register('other-company', `도장 ${index}`))
    expect(created.map((seal) => seal.status)).toEqual([201, 201, 201, 201, 201])

    expect(await register('other-company')).toMatchObject({
      status: 409,
      body: { code: 'COMPANY_SEAL_LIMIT_EXCEEDED' },
    })
    expect((await app.json('DELETE', `/company-seals/${created[0]!.body.id}`, { token: 'other-company' })).status).toBe(
      204,
    )
    expect((await register('other-company')).status).toBe(201)
  })
})

describe('signer link', () => {
  it('verifies the signer and completes the request', async () => {
    const employeeId = await hire()
    const created = await draft(employeeId)
    const sent = await app.json('POST', `/esign-requests/${created.body.id}:send`)
    const token = tokenOf(sent.body.signingUrl)

    const summary = await app.json('GET', `/esign-links/${token}`)
    expect(summary.body).toMatchObject({ recipientName: '홍*동', status: 'PENDING', documents: [{ index: 0 }] })

    const noSession = await app.json('POST', `/esign-links/${token}:complete`, { body: {} })
    expect(noSession.status).toBe(401)

    const verified = await app.json('POST', `/esign-links/${token}:verify`, {
      body: { name: '홍길동', birthDate: '1990-01-01' },
    })
    expect(verified.status).toBe(200)

    const completed = await app.json('POST', `/esign-links/${token}:complete`, {
      headers: { 'x-signer-session': verified.body.sessionToken },
      body: { signerValues: { '0': { signerAddress: 'Seoul' } } },
    })
    expect(completed.body).toMatchObject({ status: 'COMPLETED' })

    const request = await app.json('GET', `/esign-requests/${created.body.id}`)
    expect(request.body).toMatchObject({ status: 'COMPLETED', allowedActions: ['VOID', 'DOWNLOAD'] })
    expect(request.body.fieldValues['0']).toMatchObject({ signerAddress: 'Seoul' })
  })
})

describe('signer lockout', () => {
  it('counts down and then locks', async () => {
    const employeeId = await hire()
    const created = await draft(employeeId)
    const token = tokenOf((await app.json('POST', `/esign-requests/${created.body.id}:send`)).body.signingUrl)
    const wrong = { body: { name: '홍길동', birthDate: '1999-09-09' } }

    const remaining: number[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      remaining.push((await app.json('POST', `/esign-links/${token}:verify`, wrong)).body.remainingAttempts)
    }
    expect(remaining).toEqual([4, 3, 2, 1, 0])

    const locked = await app.json('POST', `/esign-links/${token}:verify`, {
      body: { name: '홍길동', birthDate: '1990-01-01' },
    })
    expect(locked.status).toBe(429)
  })
})

describe('certificates', () => {
  it('numbers, sends and voids a certificate', async () => {
    const employeeId = await hire()
    const year = new Date().getFullYear()
    const first = await app.json('POST', '/certificate-issuances', {
      body: { templateId: EMPLOYMENT_CERTIFICATE, employeeId, purpose: '은행 제출' },
    })
    const second = await app.json('POST', '/certificate-issuances', {
      body: { templateId: EMPLOYMENT_CERTIFICATE, employeeId },
    })

    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ status: 'ISSUED', recipientEmail: 'hong@example.com' })
    expect([first.body.issueNumber, second.body.issueNumber]).toEqual([`${year}-0001`, `${year}-0002`])

    const sent = await app.json('POST', `/certificate-issuances/${first.body.id}:send`)
    expect(sent.body).toMatchObject({ status: 'SENT', allowedActions: ['SEND', 'VOID'] })

    const voided = await app.json('POST', `/certificate-issuances/${first.body.id}:void`)
    expect(voided.body).toMatchObject({ status: 'VOIDED', allowedActions: [] })

    const third = await app.json('POST', '/certificate-issuances', {
      body: { templateId: EMPLOYMENT_CERTIFICATE, employeeId },
    })
    expect(third.body.issueNumber).toBe(`${year}-0003`)
  })

  it('needs a leave date for a retirement certificate', async () => {
    const employeeId = await hire()
    const issued = await app.json('POST', '/certificate-issuances', {
      body: { templateId: RETIREMENT_CERTIFICATE, employeeId },
    })

    expect(issued.status).toBe(422)
    expect(issued.body.violations).toEqual([{ field: 'employeeId', code: 'LEAVE_DATE_REQUIRED' }])
  })

  it('requires the payroll plan', async () => {
    const response = await app.json('GET', '/certificate-issuances', { token: 'no-plan' })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['PAYROLL'] })
  })
})

describe('templates', () => {
  it('lists base templates', async () => {
    const response = await app.json('GET', '/esign-templates')

    expect(response.body.items.map((template: { kind: string }) => template.kind)).toContain('SALARY_CONTRACT')
  })
})
