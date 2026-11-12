import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from '../shared/http-test-support.ts'

let app: TestApp

beforeEach(() => {
  app = startTestApp()
})

afterEach(async () => {
  await app.dispose()
})

const hire = async () =>
  (
    await app.json('POST', '/employees', {
      body: { kind: 'WAGE', name: '홍길동', registrationNumber: '900101-1234567', joinDate: '2026-01-02' },
    })
  ).body.id as string

const filingsOf = async (employeeId: string, kind?: string) =>
  (await app.json('GET', `/insurance-filings?employeeId=${employeeId}${kind === undefined ? '' : `&kind=${kind}`}`))
    .body.items as Array<{ id: string; kind: string; status: string; payload: Record<string, unknown> }>

/** 같은 밀리초에 연 신고는 순서가 정해지지 않아 상태로 정렬해 비교합니다. `WITHDRAWN`이 앞에 옵니다. */
const byStatus = (a: unknown[], b: unknown[]) => String(b[0]).localeCompare(String(a[0]))

const contract = { startDate: '2026-01-02', wageType: 'MONTHLY', amount: 3_000_000, monthlyWorkHours: 209 }

describe('4대보험 신고 큐(/v1/insurance-filings)', () => {
  it('직원을 등록하면 취득 신고를 직원 이름과 함께 보여 줍니다', async () => {
    const employeeId = await hire()
    const response = await app.json('GET', '/insurance-filings?status=PENDING')

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([
      expect.objectContaining({
        employeeId,
        employeeName: '홍길동',
        kind: 'ACQUISITION',
        status: 'PENDING',
        payload: { acquisitionDate: '2026-01-02' },
      }),
    ])
    const one = await app.json('GET', `/insurance-filings/${response.body.items[0].id}`)
    expect(one.body).toMatchObject({ kind: 'ACQUISITION', employeeName: '홍길동' })
  })

  it('완료·실패는 세무 대리인만 합니다', async () => {
    const employeeId = await hire()
    const [acquisition] = await filingsOf(employeeId)

    const byClient = await app.json('POST', `/insurance-filings/${acquisition!.id}:complete`)
    expect(byClient.status).toBe(403)

    const failed = await app.json('POST', `/insurance-filings/${acquisition!.id}:fail`, {
      token: 'agent',
      body: { message: '주민번호 불일치' },
    })
    expect(failed.body).toMatchObject({ status: 'FAILED', resultMessage: '주민번호 불일치' })

    const done = await app.json('POST', `/insurance-filings/${acquisition!.id}:complete`, { token: 'agent' })
    expect(done.body.status).toBe('DONE')
    expect(done.body).not.toHaveProperty('resultMessage')

    const again = await app.json('POST', `/insurance-filings/${acquisition!.id}:complete`, { token: 'agent' })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ code: 'INSURANCE_FILING_TRANSITION_INVALID', currentStatus: 'DONE' })
  })

  it('없는 신고는 404입니다', async () => {
    const response = await app.json('GET', '/insurance-filings/isf_01JBQ000000000000000000000')
    expect(response.status).toBe(404)
  })

  it('상실 신고에 상실일과 사유를 담고, 퇴직을 취소하면 실패한 신고도 철회합니다', async () => {
    const employeeId = await hire()
    await app.json('POST', `/employees/${employeeId}:resign`, {
      body: { leaveDate: '2026-12-31', leavingReasonCode: '11', leavingDetailReasonCode: '11-1' },
    })
    const [loss] = await filingsOf(employeeId, 'LOSS')
    expect(loss!.payload).toEqual({
      leaveDate: '2026-12-31',
      lossDate: '2027-01-01',
      leavingReasonCode: '11',
      leavingDetailReasonCode: '11-1',
    })
    await app.json('POST', `/insurance-filings/${loss!.id}:fail`, { token: 'agent', body: { message: '반려' } })

    await app.json('POST', `/employees/${employeeId}:cancel-resignation`)
    expect((await filingsOf(employeeId, 'LOSS')).map((filing) => filing.status)).toEqual(['WITHDRAWN'])
  })

  it('휴직 신고에 납부예외·고지유예를 담고, 복직일을 고치면 이전 복직 신고를 닫습니다', async () => {
    const employeeId = await hire()
    const leave = await app.json('POST', `/employees/${employeeId}/leaves`, {
      body: { reason: 'OTHER', startDate: '2026-03-02', endDate: '2026-05-31', npsPaymentException: true },
    })
    const [leaveFiling] = await filingsOf(employeeId, 'LEAVE')
    expect(leaveFiling!.payload).toEqual({
      startDate: '2026-03-02',
      endDate: '2026-05-31',
      npsPaymentException: true,
      nhisNoticeDeferral: false,
    })

    const first = await app.request('POST', `/leaves/${leave.body.id}:return`, {
      body: { actualReturnDate: '2026-05-01' },
    })
    await app.json('POST', `/leaves/${leave.body.id}:return`, {
      headers: { 'if-match': first.headers.get('etag')! },
      body: { actualReturnDate: '2026-05-11' },
    })
    const returns = await filingsOf(employeeId, 'RETURN')
    expect(returns.map((filing) => [filing.status, filing.payload]).toSorted(byStatus)).toEqual([
      ['WITHDRAWN', { leaveStartDate: '2026-03-02', returnDate: '2026-05-01' }],
      ['PENDING', { leaveStartDate: '2026-03-02', returnDate: '2026-05-11' }],
    ])
  })

  it('가입한 직원의 급여계약이 바뀌면 보수 변경 신고를 열고, 고치거나 지우면 다시 맞춥니다', async () => {
    const employeeId = await hire()
    await app.json('POST', `/employees/${employeeId}/payroll-contracts`, { body: contract })
    expect(await filingsOf(employeeId, 'REMUNERATION_CHANGE')).toEqual([])

    const raise = await app.request('POST', `/employees/${employeeId}/payroll-contracts`, {
      body: { ...contract, startDate: '2026-07-01', amount: 3_300_000 },
    })
    const raised = await raise.json()
    expect((await filingsOf(employeeId, 'REMUNERATION_CHANGE')).map((filing) => filing.payload)).toEqual([
      { effectiveFrom: '2026-07-01', wageType: 'MONTHLY', amount: 3_300_000 },
    ])

    await app.json('PUT', `/payroll-contracts/${raised.id}`, {
      headers: { 'if-match': raise.headers.get('etag') ?? `"${raised.version}"` },
      body: { ...contract, startDate: '2026-07-01', amount: 3_500_000 },
    })
    expect(
      (await filingsOf(employeeId, 'REMUNERATION_CHANGE'))
        .map((filing) => [filing.status, filing.payload.amount])
        .toSorted(byStatus),
    ).toEqual([
      ['WITHDRAWN', 3_300_000],
      ['PENDING', 3_500_000],
    ])

    await app.json('DELETE', `/payroll-contracts/${raised.id}`)
    expect((await filingsOf(employeeId, 'REMUNERATION_CHANGE')).map((filing) => filing.status)).toEqual([
      'WITHDRAWN',
      'WITHDRAWN',
    ])
  })

  it('4대보험에 모두 가입하지 않은 직원은 보수 변경 신고를 열지 않습니다', async () => {
    const employeeId = await hire()
    const excluded = { enrolled: false, exclusionReason: 'OTHER' }
    await app.json('PUT', `/employees/${employeeId}/social-insurance`, {
      body: {
        effectiveFrom: '2026-01-02',
        nps: excluded,
        nhis: excluded,
        ei: excluded,
        iais: excluded,
        isRepresentativeOrExecutive: false,
        isRepresentativeRelative: false,
      },
    })
    await app.json('POST', `/employees/${employeeId}/payroll-contracts`, { body: contract })
    await app.json('POST', `/employees/${employeeId}/payroll-contracts`, {
      body: { ...contract, startDate: '2026-07-01', amount: 3_300_000 },
    })

    expect(await filingsOf(employeeId, 'REMUNERATION_CHANGE')).toEqual([])
  })
})
