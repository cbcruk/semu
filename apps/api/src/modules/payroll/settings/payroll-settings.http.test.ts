import { afterAll, describe, expect, it } from 'vitest'
import { testActor } from '../../identity-access/testing.ts'
import { payrollTestApp } from '../payroll-testing.ts'

const app = payrollTestApp(
  [],
  [
    ['no-plan', testActor({ plans: new Set(['TAXATION']) })],
    ['reader', testActor({ permissions: new Set(['payroll-setting:read', 'payroll-setting:update']) })],
  ],
)

afterAll(() => app.dispose())

describe('/payroll-settings', () => {
  it('현행 서비스의 기본값에서 시작합니다', async () => {
    const response = await app.request('GET', '/payroll-settings')

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"0"')
    expect(response.body).toMatchObject({
      wagePeriodStartDay: 1,
      paymentMonth: 'SAME',
      paymentDay: 25,
      multipliers: { overtimeRatePpm: 1_500_000, nightRatePpm: 500_000 },
      deductionMethods: { nationalPension: 'NOTICE', employmentInsurance: 'RATE', incomeTax: 'TAX_TABLE' },
      workflow: 'DIRECT_CLOSE',
    })
  })

  it('사업장 규모가 바뀌면 수당 지급배수를 기본값으로 되돌립니다', async () => {
    const response = await app.request('PATCH', '/payroll-settings', {
      headers: { 'if-match': '"0"' },
      body: { underFiveEmployees: true, paymentMonth: 'NEXT' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(response.body.multipliers).toEqual({
      overtimeRatePpm: 1_000_000,
      nightRatePpm: 0,
      holidayRatePpm: 1_000_000,
      holidayOvertimeRatePpm: 1_000_000,
    })
  })

  it('오래된 버전은 거절합니다', async () => {
    const response = await app.request('PATCH', '/payroll-settings', {
      headers: { 'if-match': '"0"' },
      body: { paymentDay: 10 },
    })

    expect(response.status).toBe(412)
    expect(response.body).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 1 })
  })

  it('급여 요금제가 있어야 합니다', async () => {
    const response = await app.request('GET', '/payroll-settings', { token: 'no-plan' })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['PAYROLL'] })
  })

  it('운영 방식을 바꾸려면 별도 권한이 있어야 합니다', async () => {
    const response = await app.request('PATCH', '/payroll-settings', {
      token: 'reader',
      body: { workflow: 'CLIENT_APPROVAL' },
    })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'payroll-workflow:update' })
  })
})
