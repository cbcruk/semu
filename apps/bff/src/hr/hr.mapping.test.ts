import { describe, expect, it } from 'vitest'
import type { Employee } from '../upstream.types.ts'
import {
  countByStatus,
  drfPage,
  filterEmployees,
  parseEmployeeQuery,
  selectEmployees,
  toLegacyEmployee,
} from './hr.mapping.ts'

function employee(overrides: Partial<Employee>): Employee {
  return {
    id: 'emp_1',
    kind: 'WAGE',
    name: '김세무',
    joinDate: '2025-03-02',
    isRejoin: false,
    isForeigner: false,
    status: 'JOINED',
    warnings: [],
    version: 1,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('toLegacyEmployee', () => {
  it('maps enums, identity and resignation to the legacy row', () => {
    const row = toLegacyEmployee(
      employee({
        identityType: 'PASSPORT',
        registrationNumberMasked: 'M1234****',
        isForeigner: true,
        status: 'RESIGNED',
        resignation: { leaveDate: '2026-03-31', leavingReasonCode: '11' },
        warnings: ['CONTRACT_EXPIRED', 'SOMETHING_NEW'],
        departmentId: 'dpt_1',
      }),
      new Map([['dpt_1', '개발팀']]),
      new Map(),
    )

    expect(row).toMatchObject({
      identification_number_type: 'passport',
      registration_number: 'M1234****',
      is_local: false,
      status: 'RESIGNED',
      status_code: 5,
      status_display: '퇴직',
      leave_date: '2026-03-31',
      department_name: '개발팀',
      position: null,
      position_name: null,
      has_warning: true,
      warnings: ['contract_expired', 'something_new'],
    })
  })
})

describe('legacy list query', () => {
  const employees = [
    employee({ id: 'a', name: '나', status: 'LEAVE', joinDate: '2024-01-01' }),
    employee({ id: 'b', name: '가', status: 'JOINED', joinDate: '2025-01-01', warnings: ['CONTRACT_EXPIRING_SOON'] }),
    employee({ id: 'c', name: '다', status: 'RESIGNED', joinDate: '2023-01-01' }),
  ]
  const query = (search: string) => parseEmployeeQuery(new URLSearchParams(search))

  it('reads status 3 as employed including leave and 2 as working only', () => {
    expect(selectEmployees(employees, query('status=3')).map((row) => row.id)).toEqual(['a', 'b'])
    expect(selectEmployees(employees, query('status=WORKING')).map((row) => row.id)).toEqual(['b'])
  })

  it('filters by date range and contract warnings and sorts by ordering', () => {
    expect(filterEmployees(employees, query('date_type=join_date&start_date=2024-01-01')).map((row) => row.id)).toEqual(
      ['a', 'b'],
    )
    expect(filterEmployees(employees, query('contract_filter=expiring_soon')).map((row) => row.id)).toEqual(['b'])
    expect(selectEmployees(employees, query('ordering=-join_date')).map((row) => row.id)).toEqual(['b', 'a', 'c'])
  })

  it('clamps limit to the legacy bounds', () => {
    expect(query('limit=500&offset=-3')).toMatchObject({ limit: 100, offset: 0 })
    expect(query('')).toMatchObject({ limit: 20, offset: 0 })
  })

  it('rejects unknown filter values with a legacy field error', () => {
    expect(() => query('date_type=hire_date')).toThrowError(expect.objectContaining({ status: 422 }))
    expect(() => query('start_date=2026/01/01')).toThrowError(expect.objectContaining({ status: 422 }))
  })

  it('counts the tabs and pages the rows', () => {
    expect(countByStatus(employees)).toEqual({ all: 3, pre_joined: 0, working: 1, joined: 2, leave: 1, resigned: 1 })
    expect(drfPage(employees, { limit: 2, offset: 2 }, 'http://h/x?limit=2&offset=2')).toEqual({
      count: 3,
      next: null,
      previous: 'http://h/x?limit=2&offset=0',
      results: [employees[2]],
    })
  })
})
