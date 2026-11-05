import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from '../shared/http-test-support.ts'

let app: TestApp

beforeEach(() => {
  app = startTestApp()
})

afterEach(async () => {
  await app.dispose()
})

const hire = async (kind = 'WAGE') =>
  (await app.json('POST', '/employees', { body: { kind, name: '홍길동', joinDate: '2026-01-02' } })).body.id as string

const settings = {
  effectiveFrom: '2026-01-01',
  dependantsCount: 3,
  childrenAged8To20Count: 1,
  calcMethod: 'TAX_TABLE',
}

describe('/v1/employees/{employeeId}/tax-withholding', () => {
  it('returns 404 until settings are saved', async () => {
    const employeeId = await hire()
    const response = await app.json('GET', `/employees/${employeeId}/tax-withholding`)

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ code: 'TAX_WITHHOLDING_NOT_FOUND' })
  })

  it('saves settings, defaults the adjustment rate and resolves the reduction', async () => {
    const employeeId = await hire()
    const saved = await app.request('PUT', `/employees/${employeeId}/tax-withholding`, {
      body: {
        ...settings,
        reduction: {
          type: 'SMALL_BUSINESS',
          reasonCode: 'YOUTH',
          application: 'PAYROLL',
          startDate: '2026-01-01',
          endDate: '2030-12-31',
        },
      },
    })

    expect(saved.status).toBe(200)
    expect(saved.headers.get('etag')).toBe('"1"')
    expect(await saved.json()).toMatchObject({
      employeeId,
      effectiveFrom: '2026-01-01',
      adjustmentRatePpm: 1_000_000,
      reduction: { reasonCode: 'YOUTH', ratePpm: 900_000 },
      version: 1,
    })
  })

  it('keeps an effective-dated history', async () => {
    const employeeId = await hire()
    const path = `/employees/${employeeId}/tax-withholding`
    await app.json('PUT', path, { body: settings })
    await app.json('PUT', path, {
      body: { ...settings, effectiveFrom: '2026-07-01', calcMethod: 'MANUAL', manualIncomeTax: 50_000 },
      ifMatch: '"1"',
    })

    const before = await app.json('GET', `${path}?asOf=2026-06-30`)
    const after = await app.json('GET', `${path}?asOf=2026-07-01`)
    expect(before.body).toMatchObject({ effectiveFrom: '2026-01-01', calcMethod: 'TAX_TABLE', version: 2 })
    expect(after.body).toMatchObject({ effectiveFrom: '2026-07-01', calcMethod: 'MANUAL', manualIncomeTax: 50_000 })
    expect((await app.json('GET', `${path}?asOf=2025-12-31`)).status).toBe(404)
  })

  it('rejects a stale If-Match', async () => {
    const employeeId = await hire()
    const path = `/employees/${employeeId}/tax-withholding`
    await app.json('PUT', path, { body: settings })

    const stale = await app.json('PUT', path, { body: settings, ifMatch: '"0"' })
    expect(stale.status).toBe(412)
    expect(stale.body).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 1 })
  })

  it('collects deduction-validation violations', async () => {
    const employeeId = await hire()
    const response = await app.json('PUT', `/employees/${employeeId}/tax-withholding`, {
      body: { ...settings, childrenAged8To20Count: 3, calcMethod: 'MANUAL', adjustmentRatePpm: 900_000 },
    })

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('TAX_WITHHOLDING_INVALID')
    expect(response.body.violations).toEqual([
      { field: 'manualIncomeTax', code: 'REQUIRED' },
      { field: 'adjustmentRatePpm', code: 'ADJUSTMENT_RATE_NOT_ALLOWED' },
      { field: 'childrenAged8To20Count', code: 'CHILDREN_EXCEED_DEPENDANTS' },
    ])
  })

  it('refuses employees that are not wage earners', async () => {
    const employeeId = await hire('OTHER')
    const response = await app.json('PUT', `/employees/${employeeId}/tax-withholding`, { body: settings })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'EMPLOYEE_KIND_NOT_SUPPORTED', kind: 'OTHER' })
  })
})
