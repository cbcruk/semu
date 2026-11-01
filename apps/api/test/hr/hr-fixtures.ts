import { expect } from 'vitest'
import { CORP, createHrTestContext, type HrTestContext, USERS } from '../helpers/test-app'

export const HR_BASE = `/api/company/${CORP}/employment`
export const WAGE = `${HR_BASE}/wage-employees`

export type HrSuite = HrTestContext & { admin: string }

export async function hrSuite(options: { payrollPlan?: boolean } = {}): Promise<HrSuite> {
  const context = await createHrTestContext(options)
  return { ...context, admin: await context.token(USERS.admin, CORP) }
}

export async function json<T = Record<string, unknown>>(response: Response, status: number): Promise<T> {
  const text = await response.text()
  expect(response.status, text).toBe(status)
  return (text === '' ? {} : JSON.parse(text)) as T
}

export async function createEmployee(suite: HrSuite, overrides: Record<string, unknown> = {}): Promise<{ id: number; version: number } & Record<string, unknown>> {
  const response = await suite.call(suite.admin, 'POST', WAGE, {
    json: { name: '정하늘', registration_number: '950101-1000001', join_date: '2026-03-02', email: 'haneul@example.com', ...overrides },
  })
  return json(response, 201)
}

export async function versionOf(suite: HrSuite, employeeId: number): Promise<number> {
  const response = await suite.call(suite.admin, 'GET', `${WAGE}/${employeeId}`)
  await json(response, 200)
  return Number((response.headers.get('ETag') ?? '').replaceAll('"', ''))
}

export function seededId(suite: HrSuite, name: string): number {
  const row = suite.db.prepare('SELECT id FROM employees WHERE company_id = ? AND name = ?').get(CORP, name) as { id: number } | undefined
  if (row === undefined) throw new Error(`Seeded employee ${name} is missing.`)
  return row.id
}
