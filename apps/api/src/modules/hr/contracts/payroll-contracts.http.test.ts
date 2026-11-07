import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from '../shared/http-test-support.ts'

let app: TestApp

beforeEach(() => {
  app = startTestApp()
})

afterEach(async () => {
  await app.dispose()
})

const hire = async (kind = 'WAGE') =>
  (await app.json('POST', '/employees', { body: { kind, name: '홍길동', joinDate: '2026-01-02' } })).body.id as string

const contract = {
  startDate: '2026-01-02',
  wageType: 'MONTHLY',
  amount: 3_200_000,
  monthlyWorkHours: 209,
  paymentItems: [
    { paymentItemId: 'pit_01JBQ0000000000000000000M1', amount: 200_000, enabled: true, countsTowardMinimumWage: false },
  ],
  payTiming: { month: 'CURRENT', day: 25 },
  payMethod: 'TRANSFER',
  account: { bankCode: '004', accountNumber: '123-456-789012', accountHolder: '홍길동' },
}

describe('급여계약 등록(POST /v1/employees/{employeeId}/payroll-contracts)', () => {
  it('기본급을 계산하고 계좌번호를 가립니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, { body: contract })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      employeeId,
      wageType: 'MONTHLY',
      amount: 3_200_000,
      account: { bankCode: '004', accountNumberMasked: '********9012', accountHolder: '홍길동' },
      derived: { baseSalary: 3_000_000, baseHourlyWage: 14354.07, statutoryMinimumHourlyWage: 10_320 },
      warnings: [],
      version: 1,
    })
    expect(created.body.id).toMatch(/^pct_/)
    expect(JSON.stringify(created.body)).not.toContain('789012')

    const list = await app.json('GET', `/employees/${employeeId}/payroll-contracts`)
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([created.body.id])
  })

  it('최저임금에 못 미치는 계약도 경고와 함께 저장합니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, {
      body: { startDate: '2026-01-02', wageType: 'HOURLY', amount: 10_000, monthlyWorkHours: 209 },
    })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ derived: { baseSalary: 2_090_000 }, warnings: ['BELOW_MINIMUM_WAGE'] })
  })

  it('수습 지급률은 유효한 근로계약에서 가져옵니다', async () => {
    const employeeId = await hire()
    await app.json('POST', `/employees/${employeeId}/work-contracts`, {
      body: { contractType: 'PERMANENT', startDate: '2026-01-02', probation: { months: 3, payRatePpm: 900_000 } },
    })
    const created = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, {
      body: { startDate: '2026-01-02', wageType: 'MONTHLY', amount: 3_000_000, monthlyWorkHours: 209 },
    })

    expect(created.body.derived.probationHourlyWage).toBe(12918.66)
  })

  it('근로소득자가 아닌 직원은 거절합니다', async () => {
    const employeeId = await hire('BUSINESS')
    const created = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, { body: contract })

    expect(created.status).toBe(422)
    expect(created.body).toMatchObject({ code: 'EMPLOYEE_KIND_NOT_SUPPORTED', kind: 'BUSINESS' })
  })

  it('시작일보다 앞선 종료일을 거부합니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, {
      body: { ...contract, endDate: '2025-12-31' },
    })

    expect(created.status).toBe(422)
    expect(created.body).toMatchObject({
      code: 'PAYROLL_CONTRACT_INVALID',
      violations: [{ field: 'endDate', code: 'END_BEFORE_START' }],
    })
  })

  it('없는 직원이면 404입니다', async () => {
    const created = await app.json('POST', '/employees/emp_01JBQ0000000000000000000ZZ/payroll-contracts', {
      body: contract,
    })

    expect(created.status).toBe(404)
  })
})

describe('급여계약(/v1/payroll-contracts/{payrollContractId})', () => {
  it('ETag와 함께 조회하고 If-Match로 바꾸고 삭제합니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, { body: contract })
    const path = `/payroll-contracts/${created.body.id}`

    const fetched = await app.request('GET', path)
    expect(fetched.status).toBe(200)
    expect(fetched.headers.get('etag')).toBe('"1"')

    const replaced = await app.request('PUT', path, {
      body: { ...contract, amount: 3_500_000, paymentItems: [] },
      ifMatch: '"1"',
    })
    expect(replaced.status).toBe(200)
    expect(replaced.headers.get('etag')).toBe('"2"')
    expect(await replaced.json()).toMatchObject({ amount: 3_500_000, derived: { baseSalary: 3_500_000 }, version: 2 })

    const stale = await app.json('PUT', path, { body: contract, ifMatch: '"1"' })
    expect(stale.status).toBe(412)
    expect(stale.body).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 2 })

    const removed = await app.request('DELETE', path)
    expect(removed.status).toBe(204)
    expect((await app.json('GET', path)).body).toMatchObject({ code: 'PAYROLL_CONTRACT_NOT_FOUND' })
  })

  it('사유와 권한이 있으면 계좌번호 전체를 보여 줍니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, { body: contract })
    const path = `/payroll-contracts/${created.body.id}/account-number`

    const revealed = await app.json('GET', path, { headers: { 'x-access-reason': encodeURIComponent('급여 이체') } })
    expect(revealed.status).toBe(200)
    expect(revealed.body).toEqual({ accountNumber: '123456789012' })

    const denied = await app.json('GET', path, { token: 'viewer', headers: { 'x-access-reason': 'check' } })
    expect(denied.status).toBe(403)
    expect(denied.body).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'employee:reveal-account' })
  })

  it('조회 권한만 있으면 읽을 수만 있고 쓸 수 없습니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/payroll-contracts`, { body: contract })

    expect((await app.request('GET', `/payroll-contracts/${created.body.id}`, { token: 'viewer' })).status).toBe(200)
    expect((await app.request('DELETE', `/payroll-contracts/${created.body.id}`, { token: 'viewer' })).status).toBe(403)
  })
})
