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

describe('전자서명 요청', () => {
  it('수신자를 인사 정보로 채우고 초안에서 할 수 있는 액션만 보여 줍니다', async () => {
    const employeeId = await hire()
    const created = await draft(employeeId)

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      allowedActions: ['UPDATE', 'DELETE', 'SEND'],
      recipient: { employeeId, name: '홍길동', email: 'hong@example.com', isForeigner: false },
    })
  })

  it('발송할 수 없는 이유를 모두 모아 알려 줍니다', async () => {
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

  it('발송한 뒤에는 수정할 수 없고 취소는 할 수 있습니다', async () => {
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

  it('다른 회사의 도장을 고르면 NOT_FOUND 위반입니다', async () => {
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

  it('메일 발송에 실패하면 SEND_FAILED가 됩니다', async () => {
    const employeeId = await hire({ email: 'fail@example.com' })
    const created = await draft(employeeId)
    const sent = await app.json('POST', `/esign-requests/${created.body.id}:send`)

    expect(sent.body).toMatchObject({ status: 'SEND_FAILED' })
  })
})

describe('회사 도장·사인', () => {
  const register = (token: string, name = '직인') =>
    app.json('POST', '/company-seals', {
      token,
      body: { name, source: 'UPLOAD', imageFileId: 'fle_01JBQ000000000000000000002' },
    })

  it('다른 회사도 자기 도장을 등록해 그 도장으로 보낼 수 있습니다', async () => {
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

  it('도장 이름이 50자를 넘으면 거절합니다', async () => {
    expect((await register('other-company', '도'.repeat(50))).status).toBe(201)

    expect(await register('other-company', '도'.repeat(51))).toMatchObject({
      status: 400,
      body: { code: 'VALIDATION_FAILED', violations: [{ field: 'name', code: 'INVALID_VALUE' }] },
    })
  })

  it('다른 회사의 도장은 보이지 않고 지울 수도 없습니다', async () => {
    const listed = await app.json('GET', '/company-seals', { token: 'other-company' })
    const removed = await app.json('DELETE', `/company-seals/${SEAL}`, { token: 'other-company' })

    expect(listed.body.items).toEqual([])
    expect(removed).toMatchObject({ status: 404, body: { code: 'COMPANY_SEAL_NOT_FOUND' } })
  })

  it('도장은 5개까지 두고 하나를 지우면 한 자리가 빕니다', async () => {
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

describe('서명 링크', () => {
  it('서명자가 본인확인 뒤 서명하면 요청이 완료됩니다', async () => {
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

describe('서명자 잠금', () => {
  it('본인확인에 실패할 때마다 남은 횟수가 줄고 다 쓰면 잠깁니다', async () => {
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

describe('제증명 발급', () => {
  it('증명서에 발급번호를 매기고 발송하고 무효화합니다', async () => {
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

  it('퇴직증명서는 퇴사일이 있어야 발급합니다', async () => {
    const employeeId = await hire()
    const issued = await app.json('POST', '/certificate-issuances', {
      body: { templateId: RETIREMENT_CERTIFICATE, employeeId },
    })

    expect(issued.status).toBe(422)
    expect(issued.body.violations).toEqual([{ field: 'employeeId', code: 'LEAVE_DATE_REQUIRED' }])
  })

  it('급여 플랜이 있어야 발급합니다', async () => {
    const response = await app.json('GET', '/certificate-issuances', { token: 'no-plan' })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['PAYROLL'] })
  })
})

describe('전자서명 템플릿', () => {
  it('기본 템플릿 목록을 보여 줍니다', async () => {
    const response = await app.json('GET', '/esign-templates')

    expect(response.body.items.map((template: { kind: string }) => template.kind)).toContain('SALARY_CONTRACT')
  })
})
