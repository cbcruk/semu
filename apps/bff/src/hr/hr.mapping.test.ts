import { describe, expect, it } from 'vitest'
import type { Employee } from '../upstream.types.ts'
import type { OrganizationLookup } from './hr.mapping.ts'
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
      contract_type: 'none',
      contract_end_date: null,
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
    employee({ id: 'a', name: '나', status: 'LEAVE', joinDate: '2024-01-01', departmentId: 'dpt_dev' }),
    employee({ id: 'b', name: '가', status: 'JOINED', joinDate: '2025-01-01', warnings: ['CONTRACT_EXPIRING_SOON'] }),
    employee({ id: 'c', name: '다', status: 'RESIGNED', joinDate: '2023-01-01', positionId: 'pos_lead' }),
    employee({ id: 'd', name: '가', status: 'PRE_JOINED', joinDate: '2027-01-01', departmentId: 'dpt_ops' }),
  ]
  const names: OrganizationLookup = {
    departments: new Map([
      ['dpt_dev', 'Dev팀'],
      ['dpt_ops', '운영팀'],
    ]),
    positions: new Map([['pos_lead', '팀장']]),
  }
  const query = (search: string) => parseEmployeeQuery(new URLSearchParams(search))
  const ids = (rows: readonly Employee[]) => rows.map((row) => row.id)

  it('reads status 3 as employed including leave and 2 as working only', () => {
    expect(ids(selectEmployees(employees, query('status=3'), names))).toEqual(['b', 'a'])
    expect(ids(selectEmployees(employees, query('status=WORKING'), names))).toEqual(['b'])
  })

  it('sorts by name, then ID, when there is no ordering', () => {
    expect(ids(selectEmployees(employees, query(''), names))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('sorts by comma-separated legacy keys, with missing values first like SQLite', () => {
    expect(ids(selectEmployees(employees, query('ordering=-status,name'), names))).toEqual(['c', 'a', 'b', 'd'])
    expect(ids(selectEmployees(employees, query('ordering=department,-created'), names))).toEqual(['b', 'c', 'a', 'd'])
    expect(ids(selectEmployees(employees, query('ordering=position,unknown'), names))).toEqual(['a', 'b', 'd', 'c'])
  })

  it('searches name, department name and position name, ignoring ASCII case', () => {
    expect(ids(filterEmployees(employees, query('search=dev'), names))).toEqual(['a'])
    expect(ids(filterEmployees(employees, query('search=운영'), names))).toEqual(['d'])
    expect(ids(filterEmployees(employees, query('search=팀장'), names))).toEqual(['c'])
    expect(ids(filterEmployees(employees, query('search=가'), names))).toEqual(['b', 'd'])
  })

  it('filters by date range and contract warnings', () => {
    expect(
      ids(filterEmployees(employees, query('date_type=join_date&start_date=2024-01-01&end_date=2025-12-31'), names)),
    ).toEqual(['a', 'b'])
    expect(ids(filterEmployees(employees, query('contract_filter=expiring_soon'), names))).toEqual(['b'])
  })

  it('clamps limit to the legacy bounds', () => {
    expect(query('limit=500&offset=-3')).toMatchObject({ limit: 100, offset: 0 })
    expect(query('')).toMatchObject({ limit: 20, offset: 0 })
  })

  it('rejects unknown filter values with a legacy field error', () => {
    expect(() => query('date_type=hire_date')).toThrowError(expect.objectContaining({ status: 422 }))
    expect(() => query('start_date=2026/01/01')).toThrowError(expect.objectContaining({ status: 422 }))
  })

  it('counts the tabs and pages the rows from the public base URL', () => {
    expect(countByStatus(employees)).toEqual({ all: 4, pre_joined: 1, working: 1, joined: 2, leave: 1, resigned: 1 })
    expect(
      drfPage(employees, { limit: 2, offset: 2 }, { pathname: '/x', search: '?limit=2&offset=2' }, 'https://h'),
    ).toEqual({
      count: 4,
      next: null,
      previous: 'https://h/x?limit=2&offset=0',
      results: [employees[2], employees[3]],
    })
  })
})
