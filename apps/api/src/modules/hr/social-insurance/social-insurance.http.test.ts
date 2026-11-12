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
    // 급여에 적용하는 값과 같은 방식이라, 사용자가 정한 제외는 판정이 되돌리지 않습니다.
    expect(overridden.body.recommended.nhis).toEqual({ enrolled: false, exclusionReason: 'SHORT_PART_TIME' })
  })

  it('설정이 없으면 모두 가입에서 출발해 기준일로 판정합니다', async () => {
    const employeeId = (
      await app.json('POST', '/employees', {
        body: { kind: 'WAGE', name: '김예순', joinDate: '2026-01-02', birthDate: '1966-03-01' },
      })
    ).body.id as string

    const before = await app.json('POST', `/employees/${employeeId}/social-insurance:determine?asOf=2026-02-28`, {
      body: {},
    })
    expect(before.body.recommended).toEqual({ nps: enrolled, nhis: enrolled, ei: enrolled, iais: enrolled })

    const after = await app.json('POST', `/employees/${employeeId}/social-insurance:determine?asOf=2026-03-01`, {
      body: {},
    })
    expect(after.body).toMatchObject({
      determinations: ['NPS_OVER_60_INCUMBENT'],
      recommended: { nps: { enrolled: false, exclusionReason: 'AGE_60_OR_OVER' } },
    })
  })

  it('판정에 음수 주 소정근로시간은 받지 않습니다', async () => {
    const employeeId = await hire()
    const response = await app.json('POST', `/employees/${employeeId}/social-insurance:determine`, {
      body: { weeklyWorkHours: -1 },
    })

    expect(response.status).toBe(400)
  })

  it('첫 적용 시작일보다 이른 기준일은 404이고 같은 적용 시작일은 덮어씁니다', async () => {
    const employeeId = await hire()
    await app.json('PUT', `/employees/${employeeId}/social-insurance`, { body: setting })
    const overwritten = await app.json('PUT', `/employees/${employeeId}/social-insurance`, {
      headers: { 'if-match': '"1"' },
      body: { ...setting, iais: { enrolled: false, exclusionReason: 'OTHER' } },
    })
    expect(overwritten.body).toMatchObject({ version: 2, iais: { enrolled: false, exclusionReason: 'OTHER' } })

    const current = await app.json('GET', `/employees/${employeeId}/social-insurance?asOf=2026-06-30`)
    expect(current.body).toMatchObject({ effectiveFrom: '2026-01-02', iais: { enrolled: false } })

    const early = await app.json('GET', `/employees/${employeeId}/social-insurance?asOf=2026-01-01`)
    expect(early.status).toBe(404)
  })

  it('가입하는 보험에 제외 사유가 있으면 422입니다', async () => {
    const employeeId = await hire()
    const response = await app.json('PUT', `/employees/${employeeId}/social-insurance`, {
      body: { ...setting, nps: { enrolled: true, exclusionReason: 'OTHER' } },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({
      violations: [{ field: 'nps.exclusionReason', code: 'NOT_APPLICABLE' }],
    })
  })

  it('근로소득자만 설정을 저장합니다', async () => {
    const employeeId = await hire('BUSINESS')
    const response = await app.json('PUT', `/employees/${employeeId}/social-insurance`, { body: setting })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'EMPLOYEE_KIND_NOT_SUPPORTED' })
  })
})
