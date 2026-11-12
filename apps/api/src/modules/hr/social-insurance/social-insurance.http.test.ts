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

const enrolled = { enrolled: true }
const setting = {
  effectiveFrom: '2026-01-02',
  nps: enrolled,
  nhis: enrolled,
  ei: enrolled,
  iais: enrolled,
  isRepresentativeOrExecutive: false,
  isRepresentativeRelative: false,
}

describe('4대보험 설정(/v1/employees/{employeeId}/social-insurance)', () => {
  it('설정을 저장하기 전에는 404입니다', async () => {
    const employeeId = await hire()
    const response = await app.json('GET', `/employees/${employeeId}/social-insurance`)

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ code: 'SOCIAL_INSURANCE_SETTING_NOT_FOUND' })
  })

  it('판정과 다르게 저장할 수 있고 다른 보험은 경고합니다', async () => {
    const employeeId = await hire()
    const saved = await app.request('PUT', `/employees/${employeeId}/social-insurance`, {
      body: { ...setting, nps: { enrolled: false, exclusionReason: 'OTHER' } },
    })

    expect(saved.status).toBe(200)
    expect(saved.headers.get('etag')).toBe('"1"')
    expect(await saved.json()).toMatchObject({
      employeeId,
      nps: { enrolled: false, exclusionReason: 'OTHER' },
      recommended: { nps: { enrolled: true } },
      warnings: [{ code: 'ELIGIBILITY_MISMATCH', insurance: 'nps' }],
      version: 1,
    })
  })

  it('가입 여부와 제외 사유가 맞지 않으면 422입니다', async () => {
    const employeeId = await hire()
    const response = await app.json('PUT', `/employees/${employeeId}/social-insurance`, {
      body: { ...setting, ei: { enrolled: false } },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({
      code: 'SOCIAL_INSURANCE_SETTING_INVALID',
      violations: [{ field: 'ei.exclusionReason', code: 'REQUIRED' }],
    })
  })

  it('적용 시작일별 이력을 남기고 오래된 If-Match는 거절합니다', async () => {
    const employeeId = await hire()
    await app.json('PUT', `/employees/${employeeId}/social-insurance`, { body: setting })
    const second = await app.json('PUT', `/employees/${employeeId}/social-insurance`, {
      headers: { 'if-match': '"1"' },
      body: {
        ...setting,
        effectiveFrom: '2026-07-01',
        weeklyWorkHours: 10,
        nps: { enrolled: false, exclusionReason: 'SHORT_PART_TIME' },
        nhis: { enrolled: false, exclusionReason: 'SHORT_PART_TIME' },
        ei: { enrolled: false, exclusionReason: 'SHORT_PART_TIME' },
      },
    })
    expect(second.status).toBe(200)
    expect(second.body.warnings).toEqual([])

    const march = await app.json('GET', `/employees/${employeeId}/social-insurance?asOf=2026-03-31`)
    expect(march.body).toMatchObject({ effectiveFrom: '2026-01-02', nps: enrolled, version: 2 })

    const stale = await app.json('PUT', `/employees/${employeeId}/social-insurance`, {
      headers: { 'if-match': '"1"' },
      body: setting,
    })
    expect(stale.status).toBe(412)
  })

  it('본문 없이 판정하면 저장된 근로 조건으로 판정합니다', async () => {
    const employeeId = await hire()
    await app.json('PUT', `/employees/${employeeId}/social-insurance`, {
      body: {
        ...setting,
        effectiveFrom: '2026-01-02',
        weeklyWorkHours: 10,
        nps: { enrolled: false, exclusionReason: 'SHORT_PART_TIME' },
        nhis: { enrolled: false, exclusionReason: 'SHORT_PART_TIME' },
        ei: { enrolled: false, exclusionReason: 'SHORT_PART_TIME' },
      },
    })

    const stored = await app.json('POST', `/employees/${employeeId}/social-insurance:determine`, { body: {} })
    expect(stored.body.recommended.nhis).toEqual({ enrolled: false, exclusionReason: 'SHORT_PART_TIME' })

    const overridden = await app.json('POST', `/employees/${employeeId}/social-insurance:determine`, {
      body: { weeklyWorkHours: 40 },
    })
    // 저장된 가입 여부를 출발점으로 두고 바꾼 근로 조건으로 다시 판정합니다. 주 40시간이면 제외 규칙이 없어 저장값이 남습니다.
    expect(overridden.body.recommended.nhis).toEqual({ enrolled: false, exclusionReason: 'SHORT_PART_TIME' })
  })

  it('근로소득자만 설정을 저장합니다', async () => {
    const employeeId = await hire('BUSINESS')
    const response = await app.json('PUT', `/employees/${employeeId}/social-insurance`, { body: setting })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'EMPLOYEE_KIND_NOT_SUPPORTED' })
  })
})
