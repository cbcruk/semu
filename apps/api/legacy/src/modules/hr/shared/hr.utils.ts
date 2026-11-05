import { DomainError } from '../../../lib/domain-error'
import type { EmployeeKind, EmploymentType } from './hr.types'

const EMPLOYMENT_TYPE_BY_KIND: Record<EmployeeKind, EmploymentType> = {
  'wage-salary': 'wageemployee',
  daily: 'dailyemployee',
  business: 'businessemployee',
  other: 'otheremployee',
}

/** Every employee kind, in menu order. */
export const EMPLOYEE_KINDS: readonly EmployeeKind[] = ['wage-salary', 'daily', 'business', 'other']

/** Every wire employment type, in the same order as {@linkcode EMPLOYEE_KINDS}. */
export const EMPLOYMENT_TYPES: readonly EmploymentType[] = EMPLOYEE_KINDS.map((kind) => EMPLOYMENT_TYPE_BY_KIND[kind])

/**
 * Converts an employee kind to the wire `employment_type` used by e-sign recipients and certificates.
 *
 * @example Wage employees
 * ```ts
 * import { toEmploymentType } from './hr.utils'
 *
 * toEmploymentType('wage-salary') // 'wageemployee'
 * ```
 */
export function toEmploymentType(kind: EmployeeKind): EmploymentType {
  return EMPLOYMENT_TYPE_BY_KIND[kind]
}

/** Converts a wire `employment_type` back to the employee kind stored in `employees.kind`. */
export function fromEmploymentType(type: EmploymentType): EmployeeKind {
  const kind = EMPLOYEE_KINDS.find((candidate) => EMPLOYMENT_TYPE_BY_KIND[candidate] === type)
  if (kind === undefined) throw new RangeError(`Unknown employment type: ${type}`)
  return kind
}

/** Converts a boolean to a SQLite `0 | 1` flag. */
export function toFlag(value: boolean): 0 | 1 {
  return value ? 1 : 0
}

/** Converts a SQLite `0 | 1` flag to a boolean. */
export function fromFlag(value: number): boolean {
  return value === 1
}

/** Parses a JSON column, returning the fallback when it is `null`. */
export function parseJson<T>(value: string | null, fallback: T): T {
  return value === null ? fallback : (JSON.parse(value) as T)
}

/** Creates the `INVALID_TRANSITION` error used when a resource's status forbids an action. */
export function invalidState(resource: string, status: string): DomainError {
  return new DomainError('INVALID_TRANSITION', `The ${resource} is ${status} and does not allow this action.`)
}

/** Creates the `VERSION_CONFLICT` error used when `If-Match` is stale. */
export function staleVersion(resource: string): DomainError {
  return new DomainError('VERSION_CONFLICT', `The ${resource} was changed by someone else. Reload and try again.`)
}
