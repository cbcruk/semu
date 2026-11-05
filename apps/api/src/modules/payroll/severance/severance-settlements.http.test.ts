import { afterAll, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { payrollTestApp } from '../payroll-testing.ts'
import { testEmployee } from '../payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'

const LEAVER = 'emp_01JBQ000000000000000000011' as Id<'employee'>
const STAYER = 'emp_01JBQ000000000000000000012' as Id<'employee'>
const DC_MEMBER = 'emp_01JBQ000000000000000000013' as Id<'employee'>

const app = payrollTestApp([
  PayrollEmployeeDirectory.layerMemory([
    { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: LEAVER, leaveDate: '2026-10-31' }) },
    { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: STAYER }) },
    {
      companyId: TEST_COMPANY_ID,
      employee: testEmployee({ id: DC_MEMBER, leaveDate: '2026-10-31', retirementBenefitType: 'DEFINED_CONTRIBUTION' }),
    },
  ]),
])

afterAll(() => app.dispose())

describe('/severance-settlements', () => {
  let settlementId = ''

  it('calculates severance pay with the legacy-verified amounts', async () => {
    const response = await app.request('POST', '/severance-settlements', {
      body: { employeeId: LEAVER, input: { threeMonthWages: 9_000_000 } },
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      status: 'CALCULATED',
      joinDate: '2024-01-01',
      lastWorkDate: '2026-10-31',
      result: {
        eligible: true,
        serviceDays: 1_035,
        averageDailyWage: 97_826,
        severancePay: 8_321_917,
        retirementIncomeTax: 79_720,
        localIncomeTax: 7_970,
      },
      allowedActions: ['UPDATE', 'COMPLETE', 'EXCLUDE'],
    })
    settlementId = response.body.id
  })

  it('refuses a second settlement for the same leave', async () => {
    const response = await app.request('POST', '/severance-settlements', {
      body: { employeeId: LEAVER, input: { threeMonthWages: 9_000_000 } },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'SEVERANCE_SETTLEMENT_EXISTS', settlementId })
  })

  it('refuses employees who have not left or are on a pension plan', async () => {
    const stayer = await app.request('POST', '/severance-settlements', {
      body: { employeeId: STAYER, input: { threeMonthWages: 9_000_000 } },
    })
    const pension = await app.request('POST', '/severance-settlements', {
      body: { employeeId: DC_MEMBER, input: { threeMonthWages: 9_000_000 } },
    })

    expect(stayer.body).toMatchObject({ code: 'SEVERANCE_NOT_APPLICABLE', reason: 'NOT_LEFT' })
    expect(pension.body).toMatchObject({ code: 'SEVERANCE_NOT_APPLICABLE', reason: 'NOT_SEVERANCE_PAY_PLAN' })
  })

  it('completes and then refuses input changes until reopened', async () => {
    const completed = await app.request('POST', `/severance-settlements/${settlementId}:complete`, {
      headers: { 'if-match': '"1"' },
    })
    expect(completed.body).toMatchObject({ status: 'COMPLETED', allowedActions: ['REOPEN'] })

    const update = await app.request('PATCH', `/severance-settlements/${settlementId}`, {
      body: { input: { threeMonthWages: 9_300_000 } },
    })
    expect(update.status).toBe(409)
    expect(update.body).toMatchObject({ code: 'SEVERANCE_TRANSITION_INVALID', settlementStatus: 'COMPLETED' })

    await app.request('POST', `/severance-settlements/${settlementId}:reopen`)
    const reopened = await app.request('GET', `/severance-settlements/${settlementId}`)
    expect(reopened.body.status).toBe('CALCULATED')
  })
})
