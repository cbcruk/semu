import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { payrollTestApp } from '../payroll-testing.ts'
import { rateBasedSetting, testEmployee } from '../payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'

const app = payrollTestApp(
  [
    PayrollEmployeeDirectory.layerMemory([
      { companyId: TEST_COMPANY_ID, employee: testEmployee() },
      {
        companyId: TEST_COMPANY_ID,
        employee: testEmployee({ id: 'emp_01JBQ000000000000000000021' as Id<'employee'>, joinDate: '2026-04-10' }),
      },
    ]),
    PayrollSettingRepository.layerMemory([{ companyId: TEST_COMPANY_ID, setting: rateBasedSetting() }]),
  ],
  [['tax-only', testActor({ plans: new Set(['TAXATION']) })]],
)

afterAll(() => app.dispose())

beforeAll(async () => {
  const march = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2026-03' } })
  await app.request('POST', `/payroll-ledgers/${march.body.id}:submit`)
  await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2026-05' } })
})

describe('/labor-cost-reports', () => {
  it('제출한 급여대장을 귀속월별로 합하고 입력가능 대장은 뺍니다', async () => {
    const response = await app.request('GET', '/labor-cost-reports/2026')

    expect(response.status).toBe(200)
    expect(response.body.hasData).toBe(true)
    expect(response.body.months[2]).toMatchObject({
      month: '2026-03',
      amounts: { wage: 3_000_000, daily: 0, business: 0, other: 0 },
      total: 3_000_000,
      headcount: { wage: 1 },
    })
    expect(response.body.months[2].employerInsurance).toBeGreaterThan(0)
    expect(response.body.months[4].total).toBe(0)
  })

  it('인사의 고용 추이를 함께 보여 줍니다', async () => {
    const response = await app.request('GET', '/labor-cost-reports/2026')

    expect(response.body.months[3].employment).toEqual({ employed: 2, joined: 1, left: 0 })
  })

  it('세무 요금제만 있는 회사에도 엽니다', async () => {
    const response = await app.request('GET', '/labor-cost-reports/2026', { token: 'tax-only' })

    expect(response.status).toBe(200)
  })
})
