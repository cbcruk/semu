import type { DatabaseSync } from 'node:sqlite'
import { notFound } from '../../../lib/domain-error'
import type { EmployeeKind } from '../shared/hr.types'
import { findEmployeeRow } from './employees.repository'
import type { EmployeeRow } from './employees.types'

/**
 * Parses a numeric path parameter.
 *
 * @throws {DomainError} `NOT_FOUND` naming the resource when the value is not a positive integer.
 */
export function parseId(value: string | undefined, resource: string): number {
  if (value === undefined || !/^\d{1,15}$/.test(value)) throw notFound(resource)
  const id = Number(value)
  if (id <= 0) throw notFound(resource)
  return id
}

/**
 * Loads an employee of the given kind from the path parameter.
 *
 * @throws {DomainError} `NOT_FOUND` when the employee is missing, belongs to another company or has another kind.
 */
export function requireEmployee(db: DatabaseSync, companyId: string, employeeIdParam: string | undefined, kind: EmployeeKind = 'wage-salary'): EmployeeRow {
  const employee = findEmployeeRow(db, companyId, parseId(employeeIdParam, 'Employee'))
  if (employee === undefined || employee.kind !== kind) throw notFound('Employee')
  return employee
}
