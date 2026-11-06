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
 * 근로계약에서 오던 `contract_end_date`도 비고, `contract_type`은 현행의 계약 없음 값 `none`입니다(계약 만료는 `warnings`로 남습니다).
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
    contract_type: 'none',
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

/** 현행 서버와 같은 문구입니다. */
const STATUS_ERROR = 'Use status codes 1-5 or PRE_JOINED, WORKING, JOINED, LEAVE, RESIGNED.'

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
      if (mapped === undefined) throw legacyErrors.invalidField('status', STATUS_ERROR)
      for (const value of mapped) statuses.add(value)
    }
  }
  const dateType = oneOf(params, 'date_type', ['join_date', 'leave_date', 'birth_date'] as const)
  const contractFilter = oneOf(params, 'contract_filter', ['expiring_soon', 'expired'] as const)
  const startDate = date(params, 'start_date')
  const endDate = date(params, 'end_date')
  return {
    statuses,
    search: params.get('search')?.trim() || undefined,
    ordering: params.get('ordering') ?? undefined,
    dateType,
    startDate,
    endDate,
    contractFilter,
    ...pageOf(params),
  }
}

/** 현행 DRF 목록의 `limit/offset`입니다. 현행처럼 기본 20, 최대 100입니다. */
export function pageOf(params: URLSearchParams): { limit: number; offset: number } {
  const limit = Number.parseInt(params.get('limit') ?? '', 10)
  const offset = Number.parseInt(params.get('offset') ?? '', 10)
  return {
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

/** 현행 행의 부서·직위 이름입니다. 검색과 정렬이 씁니다. */
export interface OrganizationLookup {
  departments: OrganizationNames
  positions: OrganizationNames
}

function departmentName(employee: Employee, organization: OrganizationLookup): string | undefined {
  return employee.departmentId === undefined ? undefined : organization.departments.get(employee.departmentId)
}

function positionName(employee: Employee, organization: OrganizationLookup): string | undefined {
  return employee.positionId === undefined ? undefined : organization.positions.get(employee.positionId)
}

/**
 * 상태를 뺀 현행 필터(검색·기간·계약 만료)를 적용합니다. 탭 건수는 이 결과로 셉니다.
 *
 * 검색은 현행처럼 이름·부서 이름·직위 이름 중 하나에 들어 있으면 맞습니다. 현행 SQLite `LIKE`처럼 영문 대소문자를 가리지 않습니다.
 */
export function filterEmployees(
  employees: readonly Employee[],
  query: LegacyEmployeeQuery,
  organization: OrganizationLookup,
): Employee[] {
  const search = query.search?.toLowerCase()
  return employees.filter((employee) => {
    if (search !== undefined) {
      const fields = [employee.name, departmentName(employee, organization), positionName(employee, organization)]
      if (!fields.some((field) => field !== undefined && field.toLowerCase().includes(search))) return false
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

type SortValue = string | number | undefined

/** 현행 `ordering` 키 → 정렬 값입니다. 현행 서버의 `ORDER_COLUMNS`와 같은 키입니다. */
const SORT_KEYS: Record<string, (employee: Employee, organization: OrganizationLookup) => SortValue> = {
  name: (employee) => employee.name,
  status: (employee) => STATUS[employee.status].code,
  birth_date: (employee) => employee.birthDate,
  join_date: (employee) => employee.joinDate,
  leave_date: (employee) => employee.resignation?.leaveDate,
  department: departmentName,
  position: positionName,
  /** 새 직원에는 사번이 없어 모두 같은 값입니다. */
  employee_number: () => undefined,
  created: (employee) => employee.createdAt,
}

/** SQLite 정렬과 같게 비교합니다. 값이 없으면(`NULL`) 가장 작고, 문자열은 코드 단위 순서입니다. */
function compareValues(a: SortValue, b: SortValue): number {
  if (a === b) return 0
  if (a === undefined) return -1
  if (b === undefined) return 1
  return a < b ? -1 : 1
}

/**
 * 상태 필터와 정렬을 적용합니다. 현행 서버와 같이 정렬합니다.
 *
 * - `ordering`이 없으면 `name`입니다
 * - 쉼표로 여러 키를 받고(`-status,name`), `-`는 내림차순, 모르는 키는 건너뜁니다
 * - 마지막에 ID 오름차순으로 순서를 고정합니다
 */
export function selectEmployees(
  employees: readonly Employee[],
  query: LegacyEmployeeQuery,
  organization: OrganizationLookup,
): Employee[] {
  const selected = employees.filter((employee) => query.statuses?.has(employee.status) ?? true)
  const terms = (query.ordering ?? 'name')
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term !== '')
    .flatMap((term) => {
      const descending = term.startsWith('-')
      const key = SORT_KEYS[descending ? term.slice(1) : term]
      return key === undefined ? [] : [{ key, direction: descending ? -1 : 1 }]
    })
  return [...selected].sort((a, b) => {
    for (const { key, direction } of terms) {
      const order = compareValues(key(a, organization), key(b, organization))
      if (order !== 0) return direction * order
    }
    return compareValues(a.id, b.id)
  })
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

/**
 * 현행 DRF 페이지 봉투 `{count, next, previous, results}`입니다.
 *
 * 링크는 설정한 공개 주소(`publicBaseUrl`)에 요청 경로와 쿼리를 붙인 절대 주소입니다. 요청의 `Host` 헤더는 쓰지 않습니다.
 */
export function drfPage<A>(
  rows: readonly A[],
  page: { limit: number; offset: number },
  request: { pathname: string; search: string },
  publicBaseUrl: string,
): { count: number; next: string | null; previous: string | null; results: A[] } {
  const link = (offset: number): string => {
    const url = new URL(`${request.pathname}${request.search}`, `${publicBaseUrl}/`)
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
