import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { OrganizationUnitRecord } from '../organization/organization.ts'
import type { SeveranceSettlementSummary } from '../retirement/retirement.types.ts'
import {
  decideEmployeeCreation,
  decideEmployeeRemoval,
  decideEmployeeUpdate,
  decideResignation,
  decideResignationCancel,
  planEmployeeIdentity,
  type EmployeeIdentityFacts,
} from './employee.aggregate.ts'
import type { EmployeeRecord } from './employee.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>
const SELF = 'emp_01JBQ000000000000000000001' as Id<'employee'>
const OTHER = 'emp_01JBQ000000000000000000002' as Id<'employee'>
const DEPARTMENT = 'dep_01JBQ000000000000000000001' as Id<'department'>
const AT = '2026-11-14T01:00:00.000Z'
const SEALED = { hash: 'hash-1', encrypted: 'enc-1' }
const UNITS: OrganizationUnitRecord[] = [
  {
    id: DEPARTMENT,
    companyId: COMPANY,
    kind: 'DEPARTMENT',
    name: '경영지원',
    order: 1,
    everAssigned: false,
    version: 1,
  },
]
const NO_NUMBER: EmployeeIdentityFacts = { units: UNITS, sealed: undefined, sameNumber: [] }
const RESIGNATION = { leaveDate: '2026-10-31', leavingReasonCode: '11', leavingDetailReasonCode: '11-3' }

function create(input: { registrationNumber?: string; isRejoin?: boolean }, facts: EmployeeIdentityFacts) {
  return decideEmployeeCreation(
    { id: SELF, companyId: COMPANY, kind: 'WAGE', name: ' 김세무 ', joinDate: '2024-03-01', ...input },
    facts,
    AT,
  )
}

function record(overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  const created = create({}, NO_NUMBER)
  if (Result.isFailure(created)) throw created.failure
  return { ...created.success.employee, ...overrides }
}

function settlement(kind: 'RETIREMENT' | 'INTERIM', lastWorkDate: string): SeveranceSettlementSummary {
  return { kind, status: 'COMPLETED', lastWorkDate }
}

describe('직원 신원 검사', () => {
  it('없는 부서와 형식이 틀린 번호를 함께 모읍니다', () => {
    const plan = planEmployeeIdentity(
      { registrationNumber: '901301-1234567', isForeigner: false, departmentId: 'dep_x' as Id<'department'> },
      UNITS,
    )
    expect(plan.violations).toEqual([
      { field: 'departmentId', code: 'NOT_FOUND' },
      { field: 'registrationNumber', code: 'INVALID_FORMAT' },
    ])
    expect(plan.normalized).toBeUndefined()
  })

  it('외국인은 번호 종류를 주지 않으면 여권번호로 봅니다', () => {
    const plan = planEmployeeIdentity({ registrationNumber: 'm1234567', isForeigner: true }, UNITS)
    expect(plan.normalized).toEqual({ type: 'PASSPORT', value: 'M1234567' })
  })
})

describe('직원 등록 판정', () => {
  it('주민등록번호를 봉인한 값으로 저장하고 생년월일을 채웁니다', () => {
    const result = create({ registrationNumber: '900101-1234567' }, { units: UNITS, sealed: SEALED, sameNumber: [] })
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.employee).toMatchObject({
      name: '김세무',
      identityType: 'RRN',
      registrationNumberEncrypted: 'enc-1',
      registrationNumberHash: 'hash-1',
      birthDate: '1990-01-01',
      version: 1,
      createdAt: AT,
    })
    expect(result.success.employee.registrationNumberMasked).not.toContain('1234567')
  })

  it('같은 번호의 재직자가 있으면 중복입니다', () => {
    const result = create(
      { registrationNumber: '900101-1234567' },
      { units: UNITS, sealed: SEALED, sameNumber: [{ id: OTHER, status: 'JOINED' }] },
    )
    expect(Result.isFailure(result) && result.failure._tag).toBe('EmployeeDuplicate')
  })

  it('재입사로 등록하면 같은 번호의 퇴직자는 막지 않습니다', () => {
    const result = create(
      { registrationNumber: '900101-1234567', isRejoin: true },
      { units: UNITS, sealed: SEALED, sameNumber: [{ id: OTHER, status: 'RESIGNED' }] },
    )
    expect(Result.isSuccess(result)).toBe(true)
  })
})

describe('직원 수정 판정', () => {
  it('부서의 null은 지우고 빠진 필드는 그대로 둡니다', () => {
    const before = record({ departmentId: DEPARTMENT, email: 'a@example.com' })
    const result = decideEmployeeUpdate(before, { departmentId: null }, { ...NO_NUMBER }, AT)
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.employee.departmentId).toBeUndefined()
    expect(result.success.employee.email).toBe('a@example.com')
    expect(result.success.employee.version).toBe(before.version + 1)
  })

  it('자기 자신은 중복으로 보지 않습니다', () => {
    const result = decideEmployeeUpdate(
      record(),
      { registrationNumber: '900101-1234567' },
      { units: UNITS, sealed: SEALED, sameNumber: [{ id: SELF, status: 'JOINED' }] },
      AT,
    )
    expect(Result.isSuccess(result)).toBe(true)
  })
})

describe('직원 삭제·퇴직 판정', () => {
  it('중간정산만 끝났어도 삭제는 막습니다', () => {
    const result = decideEmployeeRemoval([settlement('INTERIM', '2025-12-31')])
    expect(Result.isFailure(result) && result.failure._tag).toBe('RetirementCompleted')
  })

  it('퇴직일이 완료한 중간정산 기준일보다 앞서면 거부합니다', () => {
    const result = decideResignation(
      record(),
      { ...RESIGNATION, leaveDate: '2025-06-30' },
      [settlement('INTERIM', '2025-12-31')],
      AT,
    )
    expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: 'LEAVE_DATE_BEFORE_INTERIM' })
  })

  it('퇴직을 기록하고 버전을 올립니다', () => {
    const result = decideResignation(record(), RESIGNATION, [], AT)
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.employee.resignation).toEqual(RESIGNATION)
    expect(result.success.employee.version).toBe(2)
  })

  it('퇴직하지 않은 직원의 퇴직 취소는 정산보다 먼저 거부합니다', () => {
    const result = decideResignationCancel(record(), [settlement('RETIREMENT', '2026-10-31')], AT)
    expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: 'NOT_RESIGNED' })
  })

  it('퇴직금 정산이 끝났으면 퇴직을 취소하지 않습니다', () => {
    const result = decideResignationCancel(
      record({ resignation: RESIGNATION }),
      [settlement('RETIREMENT', '2026-10-31')],
      AT,
    )
    expect(Result.isFailure(result) && result.failure._tag).toBe('RetirementCompleted')
  })

  it('퇴직을 취소하면 퇴직 기록을 지웁니다', () => {
    const result = decideResignationCancel(record({ resignation: RESIGNATION }), [], AT)
    if (Result.isFailure(result)) throw result.failure
    expect('resignation' in result.success.employee).toBe(false)
  })
})
