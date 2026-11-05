import { legacyErrors } from '../legacy-error.ts'
import type { Employee, EmployeeStatus, OrganizationUnit } from '../upstream.types.ts'

/** 현행 직원 종류(`kind`)와 소득 유형(`employment_type`)입니다. */
const KIND: Record<Employee['kind'], { kind: string; employmentType: string }> = {
  WAGE: { kind: 'wage-salary', employmentType: 'wageemployee' },
  DAILY: { kind: 'daily', employmentType: 'dailyemployee' },
  BUSINESS: { kind: 'business', employmentType: 'businessemployee' },
  OTHER: { kind: 'other', employmentType: 'otheremployee' },
}

/** 현행 상태 코드와 탭 이름입니다. 현행 `2`(`WORKING`)는 응답에 나오지 않고 필터에만 씁니다. */
const STATUS: Record<EmployeeStatus, { code: number; label: string }> = {
  PRE_JOINED: { code: 1, label: '입사예정' },
  JOINED: { code: 3, label: '재직' },
  LEAVE: { code: 4, label: '휴직' },
  RESIGNED: { code: 5, label: '퇴직' },
}

/**
 * 현행 `?status=` 값 → 새 상태입니다. 현행 `3`(`JOINED`)은 휴직을 포함한 재직 전체이고,
 * `2`(`WORKING`)가 휴직이 아닌 재직, 곧 새 `JOINED`입니다.
 */
const STATUS_FILTER: Record<string, readonly EmployeeStatus[]> = {
  '1': ['PRE_JOINED'],
  PRE_JOINED: ['PRE_JOINED'],
  '2': ['JOINED'],
  WORKING: ['JOINED'],
  '3': ['JOINED', 'LEAVE'],
  JOINED: ['JOINED', 'LEAVE'],
  '4': ['LEAVE'],
  LEAVE: ['LEAVE'],
  '5': ['RESIGNED'],
  RESIGNED: ['RESIGNED'],
}

/** 새 경고 코드 → 현행 소문자 경고입니다. */
const WARNING: Record<string, string> = {
  MISSING_REGISTRATION_NUMBER: 'missing_required_info',
  CONTRACT_EXPIRING_SOON: 'contract_expiring_soon',
  CONTRACT_EXPIRED: 'contract_expired',
  INDEFINITE_CONVERSION_TARGET: 'indefinite_conversion_target',
}

/** 새 API가 나중에 더한 enum 값은 소문자로 내보냅니다. 현행 클라이언트는 모르는 값을 표시하지 않을 뿐 깨지지 않습니다. */
function legacyEnum(map: Record<string, string>, value: string): string {
  return map[value] ?? value.toLowerCase()
}

/** 부서·직위 이름표입니다. */
export type OrganizationNames = ReadonlyMap<string, string>

/** 부서·직위 목록으로 이름표를 만듭니다. */
export function organizationNames(units: readonly OrganizationUnit[]): OrganizationNames {
  return new Map(units.map((unit) => [unit.id, unit.name]))
}

/**
 * 현행 근로소득자 목록·상세의 한 행입니다(`wage-employees/`, `wage-employees/:id/`).
 *
 * 새 직원에 없는 필드는 `null`입니다: 영문 이름, 사번, 담당업무, 거주자 여부, 등록 경로,
 * 그리고 근로계약에서 오던 `contract_type`·`contract_end_date`(계약 만료는 `warnings`로 남습니다).
 */
export function toLegacyEmployee(
  employee: Employee,
  departments: OrganizationNames,
  positions: OrganizationNames,
): Record<string, unknown> {
  const kind = KIND[employee.kind]
  const status = STATUS[employee.status]
  const warnings = employee.warnings.map((warning) => legacyEnum(WARNING, warning))
  return {
    id: employee.id,
    kind: kind.kind,
    employment_type: kind.employmentType,
    name: employee.name,
    english_name: null,
    registration_number: employee.registrationNumberMasked ?? null,
    identification_number_type:
      employee.identityType === undefined ? null : employee.identityType === 'PASSPORT' ? 'passport' : 'registration',
    birth_date: employee.birthDate ?? null,
    email: employee.email ?? null,
    phone: employee.phone ?? null,
    is_local: !employee.isForeigner,
    nationality: employee.nationalityCode ?? null,
    visa: employee.visaCode ?? null,
    is_residence: null,
    country_of_residence: null,
    status: employee.status,
    status_code: status.code,
    status_display: status.label,
    employee_number: null,
    department: employee.departmentId ?? null,
    department_name: employee.departmentId === undefined ? null : (departments.get(employee.departmentId) ?? null),
    position: employee.positionId ?? null,
    position_name: employee.positionId === undefined ? null : (positions.get(employee.positionId) ?? null),
    join_date: employee.joinDate,
    leave_date: employee.resignation?.leaveDate ?? null,
    work_code: null,
    contract_type: null,
    contract_end_date: null,
    has_warning: warnings.length > 0,
    warnings,
    is_rejoin: employee.isRejoin,
    source: null,
    version: employee.version,
    created: employee.createdAt,
    updated: employee.updatedAt,
  }
}

/** 현행 목록 쿼리 중 BFF가 받는 것입니다. */
export interface LegacyEmployeeQuery {
  statuses: ReadonlySet<EmployeeStatus> | undefined
  search: string | undefined
  ordering: string | undefined
  dateType: 'join_date' | 'leave_date' | 'birth_date' | undefined
  startDate: string | undefined
  endDate: string | undefined
  contractFilter: 'expiring_soon' | 'expired' | undefined
  limit: number
  offset: number
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 현행 목록 쿼리를 읽습니다. `limit/offset`은 현행처럼 기본 20, 최대 100으로 맞춥니다.
 *
 * @throws {LegacyError} 모르는 `status`·`date_type`·`contract_filter`, 날짜 형식이 아니면 422 `VALIDATION_FAILED`
 */
export function parseEmployeeQuery(params: URLSearchParams): LegacyEmployeeQuery {
  const status = params.get('status')
  let statuses: Set<EmployeeStatus> | undefined
  if (status !== null && status.trim() !== '') {
    statuses = new Set()
    for (const part of status.split(',')) {
      const mapped = STATUS_FILTER[part.trim().toUpperCase()]
      if (mapped === undefined) throw legacyErrors.invalidField('status', 'Unknown status.')
      for (const value of mapped) statuses.add(value)
    }
  }
  const dateType = oneOf(params, 'date_type', ['join_date', 'leave_date', 'birth_date'] as const)
  const contractFilter = oneOf(params, 'contract_filter', ['expiring_soon', 'expired'] as const)
  const startDate = date(params, 'start_date')
  const endDate = date(params, 'end_date')
  const limit = Number.parseInt(params.get('limit') ?? '', 10)
  const offset = Number.parseInt(params.get('offset') ?? '', 10)
  return {
    statuses,
    search: params.get('search')?.trim() || undefined,
    ordering: params.get('ordering') ?? undefined,
    dateType,
    startDate,
    endDate,
    contractFilter,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
  }
}

function oneOf<const T extends string>(params: URLSearchParams, name: string, values: readonly T[]): T | undefined {
  const value = params.get(name)
  if (value === null || value === '') return undefined
  if (!(values as readonly string[]).includes(value)) throw legacyErrors.invalidField(name, 'Invalid value.')
  return value as T
}

function date(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)
  if (value === null || value === '') return undefined
  if (!DATE.test(value)) throw legacyErrors.invalidField(name, 'Enter a date as YYYY-MM-DD.')
  return value
}

/** 상태를 뺀 현행 필터(검색·기간·계약 만료)를 적용합니다. 탭 건수는 이 결과로 셉니다. */
export function filterEmployees(employees: readonly Employee[], query: LegacyEmployeeQuery): Employee[] {
  const search = query.search?.toLowerCase()
  return employees.filter((employee) => {
    if (search !== undefined) {
      const haystack = [employee.name, employee.email ?? ''].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (query.dateType !== undefined) {
      const value =
        query.dateType === 'join_date'
          ? employee.joinDate
          : query.dateType === 'leave_date'
            ? employee.resignation?.leaveDate
            : employee.birthDate
      if (value === undefined) return false
      if (query.startDate !== undefined && value < query.startDate) return false
      if (query.endDate !== undefined && value > query.endDate) return false
    }
    if (query.contractFilter === 'expiring_soon' && !employee.warnings.includes('CONTRACT_EXPIRING_SOON')) return false
    if (query.contractFilter === 'expired' && !employee.warnings.includes('CONTRACT_EXPIRED')) return false
    return true
  })
}

/** 상태 필터와 정렬을 적용합니다. 정렬은 `name`, `join_date`, `leave_date`, `birth_date`와 `-` 접두사를 받습니다. */
export function selectEmployees(employees: readonly Employee[], query: LegacyEmployeeQuery): Employee[] {
  const selected = employees.filter((employee) => query.statuses?.has(employee.status) ?? true)
  const ordering = query.ordering?.trim()
  if (ordering === undefined || ordering === '') return selected
  const descending = ordering.startsWith('-')
  const field = descending ? ordering.slice(1) : ordering
  const key = SORT_KEYS[field]
  if (key === undefined) return selected
  const direction = descending ? -1 : 1
  return [...selected].sort((a, b) => direction * (key(a) ?? '').localeCompare(key(b) ?? '', 'ko'))
}

const SORT_KEYS: Record<string, (employee: Employee) => string | undefined> = {
  name: (employee) => employee.name,
  join_date: (employee) => employee.joinDate,
  leave_date: (employee) => employee.resignation?.leaveDate,
  birth_date: (employee) => employee.birthDate,
}

/** 현행 탭 건수(`count-by-status/`)입니다. */
export function countByStatus(employees: readonly Employee[]): Record<string, number> {
  const count = (status: EmployeeStatus): number => employees.filter((employee) => employee.status === status).length
  const joined = count('JOINED')
  const leave = count('LEAVE')
  return {
    all: employees.length,
    pre_joined: count('PRE_JOINED'),
    working: joined,
    joined: joined + leave,
    leave,
    resigned: count('RESIGNED'),
  }
}

/** 현행 DRF 페이지 봉투 `{count, next, previous, results}`입니다. 링크는 요청 URL 기준 절대 주소입니다. */
export function drfPage<A>(
  rows: readonly A[],
  page: { limit: number; offset: number },
  requestUrl: string,
): { count: number; next: string | null; previous: string | null; results: A[] } {
  const link = (offset: number): string => {
    const url = new URL(requestUrl)
    url.searchParams.set('limit', String(page.limit))
    url.searchParams.set('offset', String(offset))
    return url.toString()
  }
  const nextOffset = page.offset + page.limit
  return {
    count: rows.length,
    next: nextOffset < rows.length ? link(nextOffset) : null,
    previous: page.offset > 0 ? link(Math.max(0, page.offset - page.limit)) : null,
    results: rows.slice(page.offset, nextOffset),
  }
}
