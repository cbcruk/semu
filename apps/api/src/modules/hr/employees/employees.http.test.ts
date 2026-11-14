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

describe('직원 등록(POST /v1/employees)', () => {
  it('주민등록번호를 가려 보여 주고 생년월일을 채웁니다', async () => {
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

  it('근로소득자에게 주민등록번호가 없으면 경고합니다', async () => {
    const created = await hire({ registrationNumber: undefined })

    expect(created.body.warnings).toEqual(['MISSING_REGISTRATION_NUMBER'])
  })

  it('형식이 틀린 주민등록번호를 거부합니다', async () => {
    const created = await hire({ registrationNumber: '901301-1234567' })

    expect(created.status).toBe(422)
    expect(created.body).toMatchObject({
      code: 'EMPLOYEE_INVALID',
      violations: [{ field: 'registrationNumber', code: 'INVALID_FORMAT' }],
    })
  })

  it('같은 소득 유형에서 주민등록번호가 겹치면 막습니다', async () => {
    const first = await hire()
    const second = await hire({ name: '홍길동2' })

    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ code: 'EMPLOYEE_DUPLICATE', duplicateEmployeeId: first.body.id })
  })

  it('소득 유형이 다르면 같은 번호를 허용합니다', async () => {
    await hire()
    const business = await hire({ kind: 'BUSINESS' })

    expect(business.status).toBe(201)
  })

  it('퇴직한 뒤의 재입사는 허용합니다', async () => {
    const first = await hire()
    await app.json('POST', `/employees/${first.body.id}:resign`, {
      body: { leaveDate: '2024-12-31', leavingReasonCode: '11', leavingDetailReasonCode: '11-1' },
    })

    const rejoin = await hire({ joinDate: '2025-06-02', isRejoin: true })
    expect(rejoin.status).toBe(201)
  })
})

describe('직원 커맨드', () => {
  it('퇴직 처리하고 퇴직 상태로 거르고 퇴직을 취소합니다', async () => {
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

  it('입사일보다 앞선 퇴직일을 거부합니다', async () => {
    const created = await hire()
    const response = await app.json('POST', `/employees/${created.body.id}:resign`, {
      body: { leaveDate: '2023-12-31', leavingReasonCode: '11' },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'RESIGNATION_REJECTED', reason: 'LEAVE_DATE_BEFORE_JOIN' })
  })

  it('낡은 If-Match를 거부합니다', async () => {
    const created = await hire()
    const response = await app.json('PATCH', `/employees/${created.body.id}`, {
      body: { name: '홍길순' },
      ifMatch: '"9"',
    })

    expect(response.status).toBe(412)
  })

  it('사유가 있으면 주민등록번호 전체를 보여 줍니다', async () => {
    const created = await hire()
    const revealed = await app.json('POST', `/employees/${created.body.id}/registration-number:reveal`, {
      headers: { 'x-access-reason': encodeURIComponent('4대보험 신고') },
    })

    expect(revealed.status).toBe(200)
    expect(revealed.body).toEqual({ registrationNumber: '9001011234567' })
  })

  it('권한이 없으면 전체 번호를 보여 주지 않습니다', async () => {
    const created = await hire()
    const revealed = await app.json('POST', `/employees/${created.body.id}/registration-number:reveal`, {
      token: 'viewer',
      headers: { 'x-access-reason': 'check' },
    })

    expect(revealed.status).toBe(403)
    expect(revealed.body).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'employee:reveal-rrn' })
  })

  it('배정한 부서를 사용 중으로 표시합니다', async () => {
    const department = await app.json('POST', '/departments', { body: { name: '개발팀' } })
    await hire({ departmentId: department.body.id })

    const removed = await app.json('DELETE', `/departments/${department.body.id}`)
    expect(removed.status).toBe(409)
    expect(removed.body).toMatchObject({ code: 'ORGANIZATION_UNIT_IN_USE', kind: 'DEPARTMENT' })
  })
})

describe('휴직', () => {
  it('직원을 휴직으로 두고 겹치는 휴직을 거부합니다', async () => {
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

  it('위반을 모두 모읍니다', async () => {
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

describe('근로계약', () => {
  it('2년에 닿는 기간제 계약 사슬을 무기계약 전환 대상으로 표시합니다', async () => {
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

  it('1년 미만 계약의 수습 감액을 거부합니다', async () => {
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

describe('퇴직금 정산 가드(RETIREMENT_COMPLETED)', () => {
  /** 퇴사한 직원과 Payroll에서 계산한 퇴직금 정산을 만듭니다. 정산은 계산됨(`CALCULATED`)으로 시작합니다. */
  const resignWithSettlement = async () => {
    const created = await hire()
    const id: string = created.body.id
    const resigned = await app.json('POST', `/employees/${id}:resign`, {
      body: { leaveDate: '2026-06-30', leavingReasonCode: '23', leavingDetailReasonCode: '23-2' },
    })
    expect(resigned.status).toBe(200)
    const settlement = await app.json('POST', '/severance-settlements', {
      body: { employeeId: id, input: { threeMonthWages: 9_000_000 } },
    })
    expect(settlement.status).toBe(201)
    return { id, settlementId: settlement.body.id as string }
  }

  const complete = (settlementId: string) => app.json('POST', `/severance-settlements/${settlementId}:complete`)

  it('정산을 완료하면 퇴사 취소·다시 퇴사·삭제를 409로 막습니다', async () => {
    const { id, settlementId } = await resignWithSettlement()
    expect((await complete(settlementId)).body.status).toBe('COMPLETED')

    const canceled = await app.json('POST', `/employees/${id}:cancel-resignation`)
    const reResigned = await app.json('POST', `/employees/${id}:resign`, {
      body: { leaveDate: '2026-07-31', leavingReasonCode: '23', leavingDetailReasonCode: '23-2' },
    })
    const removed = await app.json('DELETE', `/employees/${id}`)

    for (const response of [canceled, reResigned, removed]) {
      expect(response.status).toBe(409)
      expect(response.body).toMatchObject({ code: 'RETIREMENT_COMPLETED' })
    }
    const employee = await app.json('GET', `/employees/${id}`)
    expect(employee.body).toMatchObject({ status: 'RESIGNED', resignation: { leaveDate: '2026-06-30' } })
  })

  it('계산됨 정산은 지급 전이라 퇴사 취소를 막지 않습니다', async () => {
    const { id } = await resignWithSettlement()

    const canceled = await app.json('POST', `/employees/${id}:cancel-resignation`)

    expect(canceled.status).toBe(200)
    expect(canceled.body).not.toHaveProperty('resignation')
  })

  it('제외한 정산은 삭제를 막지 않습니다', async () => {
    const { id, settlementId } = await resignWithSettlement()
    const excluded = await app.json('POST', `/severance-settlements/${settlementId}:exclude`, {
      body: { reason: '퇴직연금으로 지급' },
    })
    expect(excluded.body.status).toBe('EXCLUDED')

    const removed = await app.request('DELETE', `/employees/${id}`)

    expect(removed.status).toBe(204)
  })

  it('완료한 정산을 다시 열면 퇴사 취소를 허용합니다', async () => {
    const { id, settlementId } = await resignWithSettlement()
    await complete(settlementId)
    expect((await app.json('POST', `/employees/${id}:cancel-resignation`)).status).toBe(409)

    await app.json('POST', `/severance-settlements/${settlementId}:reopen`)
    const canceled = await app.json('POST', `/employees/${id}:cancel-resignation`)

    expect(canceled.status).toBe(200)
  })

  it('정산이 여럿이면 하나라도 완료면 막습니다', async () => {
    const { id, settlementId } = await resignWithSettlement()
    await app.json('POST', `/severance-settlements/${settlementId}:exclude`, { body: { reason: '다시 계산' } })
    const second = await app.json('POST', '/severance-settlements', {
      body: { employeeId: id, input: { threeMonthWages: 9_300_000 } },
    })
    expect(second.status).toBe(201)
    await complete(second.body.id)

    const removed = await app.json('DELETE', `/employees/${id}`)

    expect(removed.status).toBe(409)
    expect(removed.body).toMatchObject({ code: 'RETIREMENT_COMPLETED' })
  })
})

describe('퇴직금 중간정산과 퇴사', () => {
  /** 재직 중 직원과 Payroll에서 완료한 중간정산을 만듭니다(기준일 2026-01-31). */
  const hireWithInterim = async () => {
    const created = await hire()
    const id: string = created.body.id
    const interim = await app.json('POST', '/severance-settlements', {
      body: {
        kind: 'INTERIM',
        employeeId: id,
        settlementDate: '2026-01-31',
        interimReason: 'HOME_PURCHASE',
        input: { threeMonthWages: 9_000_000 },
      },
    })
    expect(interim.status).toBe(201)
    expect((await app.json('POST', `/severance-settlements/${interim.body.id}:complete`)).body.status).toBe('COMPLETED')
    return { id, interimId: interim.body.id as string }
  }

  it('완료한 중간정산이 있어도 퇴사·퇴사 취소는 막지 않고 삭제만 막습니다', async () => {
    const { id } = await hireWithInterim()

    const resigned = await app.json('POST', `/employees/${id}:resign`, {
      body: { leaveDate: '2026-06-30', leavingReasonCode: '23', leavingDetailReasonCode: '23-2' },
    })
    const canceled = await app.json('POST', `/employees/${id}:cancel-resignation`)
    const removed = await app.json('DELETE', `/employees/${id}`)

    expect(resigned.status).toBe(200)
    expect(canceled.status).toBe(200)
    expect(removed.status).toBe(409)
    expect(removed.body).toMatchObject({ code: 'RETIREMENT_COMPLETED' })
  })

  it('퇴직일이 완료한 중간정산 기준일보다 앞서면 422 LEAVE_DATE_BEFORE_INTERIM입니다', async () => {
    const { id } = await hireWithInterim()

    const resigned = await app.json('POST', `/employees/${id}:resign`, {
      body: { leaveDate: '2026-01-30', leavingReasonCode: '23', leavingDetailReasonCode: '23-2' },
    })

    expect(resigned.status).toBe(422)
    expect(resigned.body).toMatchObject({ reason: 'LEAVE_DATE_BEFORE_INTERIM' })
  })

  it('퇴직 정산은 중간정산 다음 날부터 근속일수를 셉니다', async () => {
    const { id } = await hireWithInterim()
    await app.json('POST', `/employees/${id}:resign`, {
      body: { leaveDate: '2026-06-30', leavingReasonCode: '23', leavingDetailReasonCode: '23-2' },
    })

    const settlement = await app.json('POST', '/severance-settlements', {
      body: { employeeId: id, input: { threeMonthWages: 9_000_000 } },
    })

    expect(settlement.status).toBe(201)
    expect(settlement.body).toMatchObject({
      kind: 'RETIREMENT',
      interimReason: null,
      joinDate: '2024-01-02',
      serviceStartDate: '2026-02-01',
      lastWorkDate: '2026-06-30',
      result: { eligible: true, serviceDays: 150 },
    })
  })
})

describe('4대보험', () => {
  it('초단시간 근로자는 제외를 권합니다', async () => {
    const created = await hire()
    const result = await app.json('POST', `/employees/${created.body.id}/social-insurance:determine`, {
      body: { weeklyWorkHours: 10 },
    })

    expect(result.body.recommended.nps).toEqual({ enrolled: false, exclusionReason: 'SHORT_PART_TIME' })
    expect(result.body.recommended.iais).toEqual({ enrolled: true })
  })
})
