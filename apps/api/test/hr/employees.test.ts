import { describe, expect, it } from 'vitest'
import { setSeveranceSettlementStatus } from '../../src/modules/hr/employees/employees.repository'
import { CORP } from '../helpers/test-app'
import { createEmployee, HR_BASE, hrSuite, json, seededId, versionOf, WAGE } from './hr-fixtures'

interface EmployeeBody {
  id: number
  name: string
  registration_number: string | null
  birth_date: string | null
  status: string
  warnings: string[]
  department_name: string | null
}

interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

describe('wage employees', () => {
  it('encrypts the registration number, returns it masked and derives the birth date', async () => {
    const suite = await hrSuite()
    const created = await createEmployee(suite)
    expect(created['registration_number']).toBe('950101-1******')
    expect(created['birth_date']).toBe('1995-01-01')
    expect(created['status']).toBe('JOINED')

    const stored = suite.db.prepare('SELECT registration_number_enc, registration_number_hash FROM employees WHERE id = ?').get(created.id) as {
      registration_number_enc: string
      registration_number_hash: string
    }
    expect(stored.registration_number_enc).not.toContain('950101')
    expect(suite.cipher.decrypt(stored.registration_number_enc)).toBe('9501011000001')
    expect(stored.registration_number_hash).toMatch(/^[0-9a-f]{64}$/)

    const masked = await suite.call(suite.admin, 'PUT', `${WAGE}/${created.id}/common-info`, {
      json: { name: '정하늘', registration_number: '950101-1******', email: 'new@example.com' },
    })
    expect((await json<{ email: string }>(masked, 200)).email).toBe('new@example.com')
    expect(suite.cipher.decrypt((suite.db.prepare('SELECT registration_number_enc FROM employees WHERE id = ?').get(created.id) as { registration_number_enc: string }).registration_number_enc)).toBe(
      '9501011000001',
    )
  })

  it('rejects duplicates unless a resigned employee rejoins', async () => {
    const suite = await hrSuite()
    const duplicate = await suite.call(suite.admin, 'POST', WAGE, {
      json: { name: '김민준', registration_number: '8803151234567', join_date: '2026-10-01' },
    })
    const body = await json<{ code: string; duplicate_employee_id: number }>(duplicate, 400)
    expect(body.code).toBe('DUPLICATE_EMPLOYEE')
    expect(body.duplicate_employee_id).toBe(seededId(suite, '김민준'))

    const resignedRrn = { name: '박지훈', registration_number: '850107-1456789', join_date: '2026-10-01' }
    expect((await json<{ code: string }>(await suite.call(suite.admin, 'POST', WAGE, { json: resignedRrn }), 400)).code).toBe('DUPLICATE_EMPLOYEE')
    const rejoined = await json<EmployeeBody & { is_rejoin: boolean }>(await suite.call(suite.admin, 'POST', WAGE, { json: { ...resignedRrn, is_rejoin: true } }), 201)
    expect(rejoined.is_rejoin).toBe(true)

    const invalid = await suite.call(suite.admin, 'POST', WAGE, { json: { name: '오류', registration_number: '1234', join_date: '2026-10-01' } })
    expect((await json<{ code: string }>(invalid, 422)).code).toBe('VALIDATION_FAILED')
  })

  it('counts by status and filters, searches and paginates the list', async () => {
    const suite = await hrSuite()
    await createEmployee(suite, { name: '입사예정', registration_number: '000101-3000001', join_date: '2026-12-01' })

    const counts = await json<Record<string, number>>(await suite.call(suite.admin, 'GET', `${WAGE}/count-by-status`), 200)
    expect(counts).toMatchObject({ all: 5, pre_joined: 1, joined: 3, working: 2, leave: 1, resigned: 1 })

    const onLeave = await json<Page<EmployeeBody>>(await suite.call(suite.admin, 'GET', `${WAGE}?status=LEAVE`), 200)
    expect(onLeave.results.map((row) => row.name)).toEqual(['이서연'])

    const working = await json<Page<EmployeeBody>>(await suite.call(suite.admin, 'GET', `${WAGE}?status=WORKING&ordering=name`), 200)
    expect(working.results.map((row) => row.name)).toEqual(['김민준', '최유진'])

    const search = await json<Page<EmployeeBody>>(await suite.call(suite.admin, 'GET', `${WAGE}?search=${encodeURIComponent('디자인')}`), 200)
    expect(search.results.map((row) => row.name)).toEqual(['이서연'])

    const first = await json<Page<EmployeeBody>>(await suite.call(suite.admin, 'GET', `${WAGE}?limit=2&ordering=name`), 200)
    expect(first.count).toBe(5)
    expect(first.results).toHaveLength(2)
    expect(first.next).toContain('offset=2')
    expect(first.previous).toBeNull()
  })

  it('warns about contracts ending within 30 days', async () => {
    const suite = await hrSuite()
    const alert = await json<{ threshold_days: number; expiring_soon_count: number; employees: { name: string; days_left: number }[] }>(
      await suite.call(suite.admin, 'GET', `${WAGE}/contract-expiry-alert`),
      200,
    )
    expect(alert.threshold_days).toBe(30)
    expect(alert.expiring_soon_count).toBe(1)
    expect(alert.employees).toEqual([expect.objectContaining({ name: '최유진', days_left: 20, status: 'expiring_soon' })])

    const detail = await json<EmployeeBody>(await suite.call(suite.admin, 'GET', `${WAGE}/${seededId(suite, '최유진')}`), 200)
    expect(detail.warnings).toContain('contract_expiring_soon')
  })

  it('edits fields last-write-wins and guards deletion after a completed retirement', async () => {
    const suite = await hrSuite()
    const created = await createEmployee(suite)
    const department = (suite.db.prepare("SELECT id FROM departments WHERE company_id = ? AND name = '개발팀'").get(CORP) as { id: number }).id
    const patched = await json<EmployeeBody>(await suite.call(suite.admin, 'PATCH', `${WAGE}/${created.id}`, { json: { department } }), 200)
    expect(patched.department_name).toBe('개발팀')
    expect(await versionOf(suite, created.id)).toBe(created.version)

    const resigned = seededId(suite, '박지훈')
    setSeveranceSettlementStatus(suite.db, CORP, resigned, 'completed', suite.clock.now())
    expect((await json<{ code: string }>(await suite.call(suite.admin, 'DELETE', `${WAGE}/${resigned}`), 400)).code).toBe('RETIREMENT_COMPLETED')

    await json(await suite.call(suite.admin, 'DELETE', `${WAGE}/${created.id}`), 204)
    expect((await suite.call(suite.admin, 'GET', `${WAGE}/${created.id}`)).status).toBe(404)
  })

  it('exports the list as a spreadsheet', async () => {
    const suite = await hrSuite()
    const response = await suite.call(suite.admin, 'GET', `${WAGE}/export`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('spreadsheetml')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b])
  })

  it('serves the legacy employee list with Korean statuses', async () => {
    const suite = await hrSuite()
    const created = await createEmployee(suite)
    suite.db.prepare('UPDATE companies SET has_payroll_plan = 0 WHERE id = ?').run(CORP)
    const page = await json<Page<{ id: number; name: string; employment_status: string; is_temp_save?: boolean }>>(
      await suite.call(suite.admin, 'GET', `/api/company/${CORP}/employee?simple=False`),
      200,
    )
    const statusOf = (name: string): string | undefined => page.results.find((row) => row.name === name)?.employment_status
    expect(statusOf('김민준')).toBe('재직')
    expect(statusOf('이서연')).toBe('휴직')
    expect(statusOf('박지훈')).toBe('퇴사')
    expect(page.results.find((row) => row.id === created.id)?.employment_status).toBe('입사처리중')

    suite.db.prepare("UPDATE employees SET registration_number_enc = NULL, registration_number_hash = NULL WHERE name = '최유진'").run()
    const simple = await json<Page<Record<string, unknown>>>(await suite.call(suite.admin, 'GET', `/api/company/${CORP}/employee?simple=True`), 200)
    const draft = simple.results.find((row) => row['name'] === '최유진')
    expect(draft?.['employment_status']).toBe('임시저장')
    expect(Object.keys(draft ?? {}).sort()).toEqual(['company', 'email', 'employment_status', 'id', 'join_date', 'kind', 'leave_date', 'name', 'registration_number'])

    const reasons = await json<{ code: string; children: unknown[] }[]>(await suite.call(suite.admin, 'GET', `/api/company/${CORP}/employee/leaving-reason`), 200)
    expect(reasons[0]).toMatchObject({ code: '11' })
    expect(reasons[0]?.children.length).toBeGreaterThan(0)
  })

  it('manages daily, business and other income earners', async () => {
    const suite = await hrSuite()
    const created = await json<{ id: number; kind: string; account_number: string | null }>(
      await suite.call(suite.admin, 'POST', `${HR_BASE}/business-employees`, {
        json: { name: '프리랜서', business_code: '940909', bank_code: '004', account_number: '123-456-789012', account_holder: '프리랜서' },
      }),
      201,
    )
    expect(created.kind).toBe('business')
    expect(created.account_number).toBe('********9012')

    const patched = await json<{ leave_date: string; status: string }>(
      await suite.call(suite.admin, 'PATCH', `${HR_BASE}/business-employees/${created.id}`, { json: { join_date: '2026-01-01', leave_date: '2026-06-30' } }),
      200,
    )
    expect(patched).toMatchObject({ leave_date: '2026-06-30', status: 'RESIGNED' })
    expect((await suite.call(suite.admin, 'PATCH', `${HR_BASE}/daily-employees/${created.id}`, { json: { name: 'x' } })).status).toBe(404)
    expect((await suite.call(suite.admin, 'GET', `${WAGE}/${created.id}`)).status).toBe(404)
    const list = await json<Page<unknown>>(await suite.call(suite.admin, 'GET', `${HR_BASE}/business-employees`), 200)
    expect(list.count).toBe(1)
  })
})
