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
  calcMethod: 'TAX_TABLE',
}

const addFamily = (employeeId: string, body: Record<string, unknown>) =>
  app.json('POST', `/employees/${employeeId}/family-members`, { body })

describe('소득세 및 기타공제(/v1/employees/{employeeId}/tax-withholding)', () => {
  it('설정을 저장하기 전에는 404입니다', async () => {
    const employeeId = await hire()
    const response = await app.json('GET', `/employees/${employeeId}/tax-withholding`)

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ code: 'TAX_WITHHOLDING_NOT_FOUND' })
  })

  it('설정을 저장하면 조정비율을 기본값으로 채우고 감면을 정합니다', async () => {
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

  it('적용 시작일별 이력을 남깁니다', async () => {
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

  it('보육수당 자녀 수는 선택이고 공제대상 가족 수와 따로 둡니다', async () => {
    const employeeId = await hire()
    const path = `/employees/${employeeId}/tax-withholding`
    const without = await app.json('PUT', path, { body: settings })
    expect(without.status).toBe(200)
    expect(without.body).not.toHaveProperty('childcareChildrenCount')

    // 배우자가 기본공제를 받는 자녀도 보육수당 대상이라 공제대상 가족 수보다 많아도 됩니다.
    const saved = await app.json('PUT', path, {
      body: {
        ...settings,
        effectiveFrom: '2026-03-01',
        childcareChildrenCount: 2,
      },
      ifMatch: '"1"',
    })
    expect(saved.status).toBe(200)
    expect((await app.json('GET', `${path}?asOf=2026-03-01`)).body).toMatchObject({ childcareChildrenCount: 2 })

    const negative = await app.json('PUT', path, {
      body: { ...settings, childcareChildrenCount: -1 },
      ifMatch: '"2"',
    })
    expect(negative.status).toBe(400)

    const tooMany = await app.json('PUT', path, {
      body: { ...settings, childcareChildrenCount: 21 },
      ifMatch: '"2"',
    })
    expect(tooMany.status).toBe(400)
  })

  it('공제대상 가족 수는 기준일의 연말정산 대상 가족에서 셉니다', async () => {
    const employeeId = await hire()
    const path = `/employees/${employeeId}/tax-withholding`
    await addFamily(employeeId, {
      name: '배우자',
      birthDate: '1990-02-01',
      relation: 'SPOUSE',
      yearEndTarget: true,
      yearEndDependantType: 'SPOUSE',
    })
    await addFamily(employeeId, {
      name: '자녀',
      birthDate: '2015-06-01',
      relation: 'CHILD',
      yearEndTarget: true,
      yearEndDependantType: 'AGE_20_OR_UNDER',
    })
    // 연말정산 대상이 아닌 가족과 기준일에 아직 태어나지 않은 가족은 세지 않습니다.
    await addFamily(employeeId, { name: '형', birthDate: '1985-01-01', relation: 'SIBLING' })
    await addFamily(employeeId, {
      name: '둘째',
      birthDate: '2026-09-01',
      relation: 'CHILD',
      yearEndTarget: true,
      yearEndDependantType: 'AGE_20_OR_UNDER',
    })

    const saved = await app.json('PUT', path, { body: { ...settings, dependantsCount: 9 } })
    expect(saved.body).toMatchObject({ dependantsCount: 3, childrenAged8To20Count: 1 })
    expect((await app.json('GET', `${path}?asOf=2026-09-01`)).body).toMatchObject({
      dependantsCount: 4,
      childrenAged8To20Count: 1,
    })
  })

  it('낡은 If-Match를 거부합니다', async () => {
    const employeeId = await hire()
    const path = `/employees/${employeeId}/tax-withholding`
    await app.json('PUT', path, { body: settings })

    const stale = await app.json('PUT', path, { body: settings, ifMatch: '"0"' })
    expect(stale.status).toBe(412)
    expect(stale.body).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 1 })
  })

  it('공제 설정 위반을 모두 모읍니다', async () => {
    const employeeId = await hire()
    const response = await app.json('PUT', `/employees/${employeeId}/tax-withholding`, {
      body: { ...settings, calcMethod: 'MANUAL', adjustmentRatePpm: 900_000 },
    })

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('TAX_WITHHOLDING_INVALID')
    expect(response.body.violations).toEqual([
      { field: 'manualIncomeTax', code: 'REQUIRED' },
      { field: 'adjustmentRatePpm', code: 'ADJUSTMENT_RATE_NOT_ALLOWED' },
    ])
  })

  it('근로소득자가 아닌 직원은 거절합니다', async () => {
    const employeeId = await hire('OTHER')
    const response = await app.json('PUT', `/employees/${employeeId}/tax-withholding`, { body: settings })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'EMPLOYEE_KIND_NOT_SUPPORTED', kind: 'OTHER' })
  })
})
