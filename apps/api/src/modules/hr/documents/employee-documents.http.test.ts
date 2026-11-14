import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from '../shared/http-test-support.ts'

const EMPLOYMENT_CONTRACT = 'est_01JBQ0000000000000000000C1'
const SALARY_CONTRACT = 'est_01JBQ0000000000000000000C2'

let app: TestApp
let sealId: string

beforeEach(async () => {
  app = startTestApp()
  const seal = await app.json('POST', '/company-seals', {
    body: { name: '대표 도장', source: 'UPLOAD', imageFileId: 'fle_01JBQ000000000000000000002' },
  })
  sealId = seal.body.id
})

afterEach(async () => {
  await app.dispose()
})

async function hire(): Promise<string> {
  const created = await app.json('POST', '/employees', {
    body: {
      kind: 'WAGE',
      name: '홍길동',
      registrationNumber: '900101-1234567',
      joinDate: '2026-03-02',
      email: 'hong@example.com',
    },
  })
  return created.body.id
}

async function workContract(employeeId: string, startDate = '2026-03-02'): Promise<string> {
  const created = await app.json('POST', `/employees/${employeeId}/work-contracts`, {
    body: { contractType: 'PERMANENT', startDate, weeklyWorkHours: 40 },
  })
  return created.body.id
}

const payrollTerms = {
  startDate: '2026-03-02',
  wageType: 'MONTHLY',
  amount: 3_500_000,
  monthlyWorkHours: 209,
  annualSalary: 42_000_000,
}

async function payrollContract(employeeId: string): Promise<string> {
  const created = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, { body: payrollTerms })
  return created.body.id
}

/** 요청을 만들어 보내고 서명자가 본인확인 뒤 서명을 마칩니다. 요청 ID를 돌려줍니다. */
async function signed(
  recipient: Record<string, unknown>,
  templateIds: string[],
  fieldValues: object,
  signerValues: object = { '0': { signerAddress: '서울' } },
): Promise<string> {
  const created = await app.json('POST', '/esign-requests', {
    body: { title: '2026 근로·연봉계약', recipient, templateIds, fieldValues, companySealId: sealId },
  })
  const sent = await app.json('POST', `/esign-requests/${created.body.id}:send`)
  const signingUrl: string = sent.body.signingUrl
  const token = signingUrl.slice(signingUrl.lastIndexOf('/') + 1)
  const verified = await app.json('POST', `/esign-links/${token}:verify`, {
    body: { name: '홍길동', birthDate: '1990-01-01' },
  })
  const completed = await app.json('POST', `/esign-links/${token}:complete`, {
    headers: { 'x-signer-session': verified.body.sessionToken },
    body: { signerValues },
  })
  expect(completed.body).toMatchObject({ status: 'COMPLETED' })
  return created.body.id
}

const contractFields = {
  '0': { workPlace: '본사', jobDescription: '회계' },
  '1': { annualSalary: 42_000_000, effectiveDate: '2026-03-02' },
}

describe('전자서명 완료를 문서 보관함에 반영', () => {
  it('근로·연봉계약서 완료본을 보관함에 넣고 확정한 계약에 잇습니다', async () => {
    const employeeId = await hire()
    const workContractId = await workContract(employeeId)
    const payrollContractId = await payrollContract(employeeId)

    const requestId = await signed({ employeeId }, [EMPLOYMENT_CONTRACT, SALARY_CONTRACT], contractFields)

    const list = await app.json('GET', `/employees/${employeeId}/documents`, { token: 'viewer' })
    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(1)
    const document = list.body.items[0]
    expect(document).toMatchObject({
      employeeId,
      category: 'CONTRACT',
      origin: 'ESIGN',
      title: '2026 근로·연봉계약',
      esignRequestId: requestId,
      status: 'ACTIVE',
      links: [
        { type: 'WORK_CONTRACT', id: workContractId },
        { type: 'PAYROLL_CONTRACT', id: payrollContractId },
      ],
    })
    expect(document.id).toMatch(/^doc_/)
    expect(document.fileId).toMatch(/^fle_/)
    expect(JSON.stringify(document)).not.toContain('서울')

    expect((await app.json('GET', `/employee-documents/${document.id}`)).body).toEqual(document)
    const contracts = await app.json('GET', `/employees/${employeeId}/work-contracts`)
    expect(contracts.body.items[0]).toMatchObject({ id: workContractId, signedDocumentId: document.id })
    const payroll = await app.json('GET', `/payroll-contracts/${payrollContractId}`)
    expect(payroll.body).toMatchObject({ signedDocumentId: document.id })
  })

  it('근로개시일을 비워 둔 근로계약서는 입사일에 시작하는 계약에 잇습니다', async () => {
    const employeeId = await hire()
    await workContract(employeeId, '2027-03-02')
    const atJoin = await workContract(employeeId, '2026-03-02')

    await signed({ employeeId }, [EMPLOYMENT_CONTRACT], { '0': contractFields['0'] })

    const [document] = (await app.json('GET', `/employees/${employeeId}/documents`)).body.items
    expect(document.links).toEqual([{ type: 'WORK_CONTRACT', id: atJoin }])
  })

  it('맞는 계약이 없어도 완료본은 보관함에 넣습니다', async () => {
    const employeeId = await hire()

    await signed({ employeeId }, [EMPLOYMENT_CONTRACT], { '0': contractFields['0'] })

    const list = await app.json('GET', `/employees/${employeeId}/documents`)
    expect(list.body.items).toMatchObject([{ category: 'CONTRACT', links: [] }])
  })

  it('급여계약을 고치면 서명 문서가 풀립니다', async () => {
    const employeeId = await hire()
    const payrollContractId = await payrollContract(employeeId)
    await signed({ employeeId }, [EMPLOYMENT_CONTRACT, SALARY_CONTRACT], contractFields)

    const current = await app.json('GET', `/payroll-contracts/${payrollContractId}`)
    const updated = await app.json('PUT', `/payroll-contracts/${payrollContractId}`, {
      headers: { 'if-match': `"${current.body.version}"` },
      body: { ...payrollTerms, amount: 3_600_000, annualSalary: 43_200_000 },
    })
    expect(updated.status).toBe(200)
    expect(updated.body.signedDocumentId).toBeUndefined()
  })

  it('서명자는 관리자가 정한 계약 조건을 덮어써 다른 계약을 확정할 수 없습니다', async () => {
    const employeeId = await hire()
    const offered = await payrollContract(employeeId)
    const other = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, {
      body: { ...payrollTerms, amount: 3_000_000, annualSalary: 36_000_000 },
    })

    const requestId = await signed({ employeeId }, [EMPLOYMENT_CONTRACT, SALARY_CONTRACT], contractFields, {
      '0': { signerAddress: '서울', startDate: '2030-01-01' },
      '1': { annualSalary: 36_000_000 },
    })

    const [document] = (await app.json('GET', `/employees/${employeeId}/documents`)).body.items
    expect(document.links).toContainEqual({ type: 'PAYROLL_CONTRACT', id: offered })
    expect(document.links).not.toContainEqual({ type: 'PAYROLL_CONTRACT', id: other.body.id })
    const request = await app.json('GET', `/esign-requests/${requestId}`)
    expect(request.body.fieldValues['1']).toMatchObject({ annualSalary: 42_000_000 })
    expect(request.body.fieldValues['0']).toMatchObject({ signerAddress: '서울' })
    expect(request.body.fieldValues['0'].startDate).toBeUndefined()
  })

  it('급여계약의 계좌만 바꾸면 서명 문서가 남고, 연결이 바뀌면 버전이 오릅니다', async () => {
    const employeeId = await hire()
    const payrollContractId = await payrollContract(employeeId)
    await signed({ employeeId }, [EMPLOYMENT_CONTRACT, SALARY_CONTRACT], contractFields)

    const current = await app.json('GET', `/payroll-contracts/${payrollContractId}`)
    expect(current.body.version).toBe(2)
    const updated = await app.json('PUT', `/payroll-contracts/${payrollContractId}`, {
      headers: { 'if-match': `"${current.body.version}"` },
      body: {
        ...payrollTerms,
        account: { bankCode: '004', accountNumber: '123-456-789012', accountHolder: '홍길동' },
      },
    })
    expect(updated.status).toBe(200)
    expect(updated.body.signedDocumentId).toBe(current.body.signedDocumentId)
  })

  it('완료한 요청을 무효로 하면 문서는 남고 계약에서 풀립니다', async () => {
    const employeeId = await hire()
    const workContractId = await workContract(employeeId)
    const requestId = await signed({ employeeId }, [EMPLOYMENT_CONTRACT], { '0': contractFields['0'] })

    const voided = await app.json('POST', `/esign-requests/${requestId}:void`)
    expect(voided.body).toMatchObject({ status: 'VOIDED' })

    const list = await app.json('GET', `/employees/${employeeId}/documents`)
    expect(list.body.items).toMatchObject([
      { status: 'VOIDED', links: [{ type: 'WORK_CONTRACT', id: workContractId }] },
    ])
    expect(list.body.items[0].voidedAt).toEqual(expect.any(String))
    const contracts = await app.json('GET', `/employees/${employeeId}/work-contracts`)
    expect(contracts.body.items[0].signedDocumentId).toBeUndefined()
  })

  it('다시 서명받은 계약은 예전 요청을 무효로 해도 새 서명 문서를 지킵니다', async () => {
    const employeeId = await hire()
    await workContract(employeeId)
    const first = await signed({ employeeId }, [EMPLOYMENT_CONTRACT], { '0': contractFields['0'] })
    await signed({ employeeId }, [EMPLOYMENT_CONTRACT], { '0': contractFields['0'] })
    const second = (await app.json('GET', `/employees/${employeeId}/documents`)).body.items.find(
      (item: { esignRequestId: string }) => item.esignRequestId !== first,
    )

    await app.json('POST', `/esign-requests/${first}:void`)

    const contracts = await app.json('GET', `/employees/${employeeId}/work-contracts`)
    expect(contracts.body.items[0].signedDocumentId).toBe(second.id)
  })

  it('수신자가 직원이 아니면 보관함에 넣지 않습니다', async () => {
    const employeeId = await hire()

    await signed({ name: '홍길동', email: 'new@example.com' }, [EMPLOYMENT_CONTRACT], {
      '0': { ...contractFields['0'], employeeName: '홍길동', startDate: '2026-03-02' },
    })

    expect((await app.json('GET', `/employees/${employeeId}/documents`)).body.items).toEqual([])
  })

  it('카테고리로 거르고, 없는 문서는 404입니다', async () => {
    const employeeId = await hire()
    await signed({ employeeId }, [EMPLOYMENT_CONTRACT], { '0': contractFields['0'] })

    const certificates = await app.json('GET', `/employees/${employeeId}/documents?category=CERTIFICATE`)
    expect(certificates.body.items).toEqual([])
    const missing = await app.json('GET', '/employee-documents/doc_01JBQ000000000000000000000')
    expect(missing).toMatchObject({ status: 404, body: { code: 'EMPLOYEE_DOCUMENT_NOT_FOUND' } })
    const noEmployee = await app.json('GET', '/employees/emp_01JBQ000000000000000000000/documents')
    expect(noEmployee.status).toBe(404)
  })
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

async function upload(
  employeeId: string,
  query = 'title=%EC%9E%AC%EC%A7%81%EC%A6%9D%EB%AA%85&category=OTHER&fileName=%EC%82%AC%EB%B3%B8.png',
  token?: string,
) {
  return app.json('POST', `/employees/${employeeId}/documents?${query}`, {
    raw: { bytes: PNG, contentType: 'image/png' },
    token,
  })
}

describe('문서 내려받기·직접 올리기·지우기', () => {
  it('서명 완료본을 PDF로 내려받습니다', async () => {
    const employeeId = await hire()
    await signed({ employeeId }, [EMPLOYMENT_CONTRACT], { '0': contractFields['0'] })
    const [document] = (await app.json('GET', `/employees/${employeeId}/documents`)).body.items
    expect(document).toMatchObject({ fileName: '2026 근로·연봉계약.pdf', contentType: 'application/pdf' })

    const response = await app.request('GET', `/employee-documents/${document.id}/file`, {
      token: 'viewer',
      headers: { 'x-access-reason': encodeURIComponent('계약 확인') },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('2026 근로·연봉계약.pdf')}`,
    )
    const text = Buffer.from(await response.arrayBuffer()).toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('직접 올린 문서는 보관함에 들어오고 올린 그대로 내려받습니다', async () => {
    const employeeId = await hire()
    const created = await upload(employeeId)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      employeeId,
      origin: 'UPLOAD',
      category: 'OTHER',
      title: '재직증명',
      fileName: '사본.png',
      contentType: 'image/png',
      status: 'ACTIVE',
      links: [],
    })
    expect(created.body).not.toHaveProperty('esignRequestId')
    expect(created.body).not.toHaveProperty('signedAt')

    const response = await app.request('GET', `/employee-documents/${created.body.id}/file`, {
      headers: { 'x-access-reason': 'check' },
    })
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
    const list = await app.json('GET', `/employees/${employeeId}/documents?category=OTHER`)
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([created.body.id])
  })

  it('허용하지 않는 형식은 415이고 아무것도 남지 않습니다', async () => {
    const employeeId = await hire()
    const response = await app.request(
      'POST',
      `/employees/${employeeId}/documents?title=a&category=OTHER&fileName=a.exe`,
      {
        raw: { bytes: PNG, contentType: 'application/x-msdownload' },
      },
    )
    expect(response.status).toBe(415)
    expect((await app.json('GET', `/employees/${employeeId}/documents`)).body.items).toEqual([])
  })

  it('형식은 보낸 Content-Type이 아니라 내용으로 정합니다', async () => {
    const employeeId = await hire()
    const response = await app.json(
      'POST',
      `/employees/${employeeId}/documents?title=a&category=OTHER&fileName=a.png`,
      {
        raw: { bytes: new TextEncoder().encode('MZ not an image'), contentType: 'image/png' },
      },
    )
    expect(response.status).toBe(415)
    expect(response.body).toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
      allowedContentTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    })
  })

  it('내려받으려면 열람 사유가 있어야 합니다', async () => {
    const employeeId = await hire()
    const created = await upload(employeeId)
    expect((await app.request('GET', `/employee-documents/${created.body.id}/file`)).status).toBe(400)
  })

  it('빈 파일은 413 FILE_SIZE_INVALID입니다', async () => {
    const employeeId = await hire()
    const response = await app.json(
      'POST',
      `/employees/${employeeId}/documents?title=a&category=OTHER&fileName=a.png`,
      {
        raw: { bytes: new Uint8Array(), contentType: 'image/png' },
      },
    )
    expect(response.status).toBe(413)
    expect(response.body).toMatchObject({ code: 'FILE_SIZE_INVALID' })
  })

  it('읽기 권한만 있으면 올리거나 지울 수 없습니다', async () => {
    const employeeId = await hire()
    expect((await upload(employeeId, undefined, 'viewer')).status).toBe(403)
    const created = await upload(employeeId)
    expect((await app.json('DELETE', `/employee-documents/${created.body.id}`, { token: 'viewer' })).status).toBe(403)
  })

  it('없는 직원에게는 올릴 수 없습니다', async () => {
    const response = await upload('emp_01JBQ0000000000000000000ZZ')
    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' })
  })

  it('직접 올린 문서는 지우고, 서명 완료본은 409 DOCUMENT_LOCKED입니다', async () => {
    const employeeId = await hire()
    const created = await upload(employeeId)
    expect((await app.json('DELETE', `/employee-documents/${created.body.id}`)).status).toBe(204)
    expect((await app.json('GET', `/employee-documents/${created.body.id}`)).status).toBe(404)

    await signed({ employeeId }, [EMPLOYMENT_CONTRACT], { '0': contractFields['0'] })
    const [document] = (await app.json('GET', `/employees/${employeeId}/documents`)).body.items
    const locked = await app.json('DELETE', `/employee-documents/${document.id}`)
    expect(locked.status).toBe(409)
    expect(locked.body).toMatchObject({ code: 'DOCUMENT_LOCKED', origin: 'ESIGN' })
  })

  it('없는 문서의 본문은 404입니다', async () => {
    const response = await app.json('GET', '/employee-documents/doc_01JBQ0000000000000000000ZZ/file', {
      headers: { 'x-access-reason': 'check' },
    })
    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ code: 'EMPLOYEE_DOCUMENT_NOT_FOUND' })
  })
})
