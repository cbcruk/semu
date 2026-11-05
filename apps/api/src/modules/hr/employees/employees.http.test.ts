import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from '../shared/http-test-support.ts'

let app: TestApp

beforeEach(() => {
  app = startTestApp()
})

afterEach(async () => {
  await app.dispose()
})

const hire = (overrides: Record<string, unknown> = {}) =>
  app.json('POST', '/employees', {
    body: { kind: 'WAGE', name: '홍길동', registrationNumber: '900101-1234567', joinDate: '2024-01-02', ...overrides },
  })

describe('POST /v1/employees', () => {
  it('stores the registration number masked and derives the birth date', async () => {
    const created = await hire()

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      registrationNumberMasked: '900101-1******',
      birthDate: '1990-01-01',
      status: 'JOINED',
      warnings: [],
      version: 1,
    })
    expect(created.body).not.toHaveProperty('registrationNumberEncrypted')
  })

  it('warns when a wage employee has no registration number', async () => {
    const created = await hire({ registrationNumber: undefined })

    expect(created.body.warnings).toEqual(['MISSING_REGISTRATION_NUMBER'])
  })

  it('rejects a malformed registration number', async () => {
    const created = await hire({ registrationNumber: '901301-1234567' })

    expect(created.status).toBe(422)
    expect(created.body).toMatchObject({
      code: 'EMPLOYEE_INVALID',
      violations: [{ field: 'registrationNumber', code: 'INVALID_FORMAT' }],
    })
  })

  it('blocks a duplicate registration number of the same kind', async () => {
    const first = await hire()
    const second = await hire({ name: '홍길동2' })

    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ code: 'EMPLOYEE_DUPLICATE', duplicateEmployeeId: first.body.id })
  })

  it('allows the same number for another kind', async () => {
    await hire()
    const business = await hire({ kind: 'BUSINESS' })

    expect(business.status).toBe(201)
  })

  it('allows a rejoin after resignation', async () => {
    const first = await hire()
    await app.json('POST', `/employees/${first.body.id}:resign`, {
      body: { leaveDate: '2024-12-31', leavingReasonCode: '11', leavingDetailReasonCode: '11-1' },
    })

    const rejoin = await hire({ joinDate: '2025-06-02', isRejoin: true })
    expect(rejoin.status).toBe(201)
  })
})

describe('employee commands', () => {
  it('resigns, filters by status and cancels the resignation', async () => {
    const created = await hire()
    const resigned = await app.request('POST', `/employees/${created.body.id}:resign`, {
      body: { leaveDate: '2025-01-31', leavingReasonCode: '23', leavingDetailReasonCode: '23-2' },
      ifMatch: '"1"',
    })
    expect(resigned.status).toBe(200)
    expect(resigned.headers.get('etag')).toBe('"2"')
    expect(await resigned.json()).toMatchObject({ status: 'RESIGNED', resignation: { leaveDate: '2025-01-31' } })

    const list = await app.json('GET', '/employees?status=RESIGNED')
    expect(list.body.items.map((employee: { id: string }) => employee.id)).toEqual([created.body.id])

    const canceled = await app.json('POST', `/employees/${created.body.id}:cancel-resignation`)
    expect(canceled.body).toMatchObject({ status: 'JOINED', version: 3 })
    expect(canceled.body).not.toHaveProperty('resignation')
  })

  it('rejects a resignation before the join date', async () => {
    const created = await hire()
    const response = await app.json('POST', `/employees/${created.body.id}:resign`, {
      body: { leaveDate: '2023-12-31', leavingReasonCode: '11' },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'RESIGNATION_REJECTED', reason: 'LEAVE_DATE_BEFORE_JOIN' })
  })

  it('rejects a stale If-Match', async () => {
    const created = await hire()
    const response = await app.json('PATCH', `/employees/${created.body.id}`, {
      body: { name: '홍길순' },
      ifMatch: '"9"',
    })

    expect(response.status).toBe(412)
  })

  it('reveals the registration number with a reason', async () => {
    const created = await hire()
    const revealed = await app.json('POST', `/employees/${created.body.id}/registration-number:reveal`, {
      headers: { 'x-access-reason': encodeURIComponent('4대보험 신고') },
    })

    expect(revealed.status).toBe(200)
    expect(revealed.body).toEqual({ registrationNumber: '9001011234567' })
  })

  it('refuses to reveal without permission', async () => {
    const created = await hire()
    const revealed = await app.json('POST', `/employees/${created.body.id}/registration-number:reveal`, {
      token: 'viewer',
      headers: { 'x-access-reason': 'check' },
    })

    expect(revealed.status).toBe(403)
    expect(revealed.body).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'employee:reveal-rrn' })
  })

  it('marks an assigned department as in use', async () => {
    const department = await app.json('POST', '/departments', { body: { name: '개발팀' } })
    await hire({ departmentId: department.body.id })

    const removed = await app.json('DELETE', `/departments/${department.body.id}`)
    expect(removed.status).toBe(409)
    expect(removed.body).toMatchObject({ code: 'ORGANIZATION_UNIT_IN_USE', kind: 'DEPARTMENT' })
  })
})

describe('leaves', () => {
  it('puts the employee on leave and rejects an overlapping leave', async () => {
    const created = await hire()
    const leave = await app.json('POST', `/employees/${created.body.id}/leaves`, {
      body: { reason: 'PARENTAL', startDate: '2026-01-01', endDate: '2026-12-31' },
    })
    expect(leave.status).toBe(201)
    expect(leave.body).toMatchObject({ expectedReturnDate: '2027-01-01', includeInServiceYears: true })

    const overlap = await app.json('POST', `/employees/${created.body.id}/leaves`, {
      body: { reason: 'OTHER', startDate: '2026-12-31', endDate: '2027-01-31' },
    })
    expect(overlap.status).toBe(409)
    expect(overlap.body).toMatchObject({ code: 'LEAVE_OVERLAP', overlappingLeaveId: leave.body.id })

    const returned = await app.json('POST', `/leaves/${leave.body.id}:return`, {
      body: { actualReturnDate: '2026-06-01' },
    })
    expect(returned.body).toMatchObject({ actualReturnDate: '2026-06-01', version: 2 })
  })

  it('collects every violation', async () => {
    const created = await hire()
    const leave = await app.json('POST', `/employees/${created.body.id}/leaves`, {
      body: { reason: 'OTHER', startDate: '2023-01-01', endDate: '2022-12-31', paid: {} },
    })

    expect(leave.status).toBe(422)
    expect(leave.body.violations.map((violation: { code: string }) => violation.code)).toEqual([
      'END_BEFORE_START',
      'BEFORE_JOIN_DATE',
      'PAID_ALLOWANCE_REQUIRED',
    ])
  })
})

describe('work contracts', () => {
  it('flags a fixed-term chain reaching two years', async () => {
    const created = await hire({ joinDate: '2024-07-01' })
    const path = `/employees/${created.body.id}/work-contracts`
    await app.json('POST', path, {
      body: { contractType: 'FIXED_TERM', startDate: '2024-07-01', endDate: '2025-06-30' },
    })
    await app.json('POST', path, {
      body: { contractType: 'FIXED_TERM', startDate: '2025-07-01', endDate: '2026-07-01' },
    })

    const conversion = await app.json('GET', `/employees/${created.body.id}/indefinite-conversion`)
    expect(conversion.body).toMatchObject({ isTarget: true, status: 'EXCEEDED', conversionDate: '2026-07-01' })
  })

  it('rejects reduced probation pay on a short contract', async () => {
    const created = await hire()
    const contract = await app.json('POST', `/employees/${created.body.id}/work-contracts`, {
      body: {
        contractType: 'FIXED_TERM',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        probation: { months: 3, payRatePpm: 900000 },
      },
    })

    expect(contract.status).toBe(422)
    expect(contract.body.violations).toEqual([
      { field: 'probation.payRatePpm', code: 'PROBATION_REDUCTION_NOT_ALLOWED' },
    ])
  })
})

describe('social insurance', () => {
  it('recommends excluding short part-timers', async () => {
    const created = await hire()
    const result = await app.json('POST', `/employees/${created.body.id}/social-insurance:determine`, {
      body: { weeklyWorkHours: 10 },
    })

    expect(result.body.recommended.nps).toEqual({ enrolled: false, exclusionReason: 'SHORT_PART_TIME' })
    expect(result.body.recommended.iais).toEqual({ enrolled: true })
  })
})
