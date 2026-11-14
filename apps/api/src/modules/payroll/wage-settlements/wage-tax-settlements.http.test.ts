import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { clockAt, payrollTestApp } from '../payroll-testing.ts'
import { rateBasedSetting, testEmployee } from '../payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayrollEventPublisher } from '../ports/payroll-events.ts'
import type { PayrollEvent } from '../ports/payroll-events.types.ts'
import { WithholdingFilingLock } from '../ports/withholding-filing-lock.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'

const LEAVER = 'emp_01JBQ000000000000000000031' as Id<'employee'>
const STAYER = 'emp_01JBQ000000000000000000032' as Id<'employee'>
const NEWCOMER = 'emp_01JBQ000000000000000000033' as Id<'employee'>

const events: PayrollEvent[] = []

/** 2026년 귀속 연말정산을 할 수 있도록 다음 해 1월에 둡니다. */
const app = payrollTestApp(
  [
    PayrollEmployeeDirectory.layerMemory([
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: LEAVER, name: '이중도', leaveDate: '2026-03-31' }) },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: STAYER, name: '박재직' }) },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: NEWCOMER, name: '최신입', joinDate: '2027-01-02' }) },
    ]),
    PayrollSettingRepository.layerMemory([{ companyId: TEST_COMPANY_ID, setting: rateBasedSetting() }]),
    PayrollEventPublisher.layerMemory(events),
    WithholdingFilingLock.layerMemory([{ companyId: TEST_COMPANY_ID, paymentMonth: '2027-01' }]),
    clockAt('2027-01-10T00:00:00+09:00'),
  ],
  [['viewer', testActor({ permissions: new Set(['wage-tax-settlement:read']) })]],
)

afterAll(() => app.dispose())

beforeAll(async () => {
  for (const month of ['2026-01', '2026-02', '2026-03']) {
    const created = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: month } })
    if (created.status !== 201) throw new Error(`대장을 만들지 못했습니다: ${JSON.stringify(created.body)}`)
    const closed = await app.request('POST', `/payroll-ledgers/${created.body.id}:close`)
    if (closed.status !== 200) throw new Error(`대장을 마감하지 못했습니다: ${JSON.stringify(closed.body)}`)
  }
})

describe('/wage-tax-settlements 중도퇴사자 연말정산(A02)', () => {
  let settlementId = ''

  it('퇴사월까지 마감된 대장으로 결정세액을 계산하고 기납부세액보다 적으면 환급합니다', async () => {
    const response = await app.request('POST', '/wage-tax-settlements', {
      body: { kind: 'MID_YEAR', employeeId: LEAVER, year: '2026' },
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(response.body).toMatchObject({
      kind: 'MID_YEAR',
      employeeName: '이중도',
      leaveDate: '2026-03-31',
      dependants: 1,
      status: 'CALCULATED',
      paymentDate: null,
      totals: { months: ['2026-01', '2026-02', '2026-03'], taxablePay: 9_000_000, withheldIncomeTax: 223_050 },
      result: {
        totalPay: 9_000_000,
        earnedIncomeDeduction: 5_100_000,
        earnedIncome: 3_900_000,
        deductionMethod: 'STANDARD',
        determinedTax: 0,
        balanceIncomeTax: -223_050,
      },
      allowedActions: ['UPDATE', 'COMPLETE', 'DELETE'],
    })
    expect(response.body.result.balanceLocalIncomeTax).toBe(-response.body.totals.withheldLocalIncomeTax)
    settlementId = response.body.id
  })

  it('같은 직원·연도·종류의 두 번째 정산은 거절합니다', async () => {
    const response = await app.request('POST', '/wage-tax-settlements', {
      body: { kind: 'MID_YEAR', employeeId: LEAVER, year: '2026' },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'WAGE_SETTLEMENT_EXISTS', settlementId })
  })

  it('정산할 수 없는 직원·연도는 사유와 함께 거절합니다', async () => {
    const stayer = await app.request('POST', '/wage-tax-settlements', {
      body: { kind: 'MID_YEAR', employeeId: STAYER, year: '2026' },
    })
    const leaverAnnual = await app.request('POST', '/wage-tax-settlements', {
      body: { kind: 'ANNUAL', employeeId: LEAVER, year: '2026' },
    })
    const newcomer = await app.request('POST', '/wage-tax-settlements', {
      body: { kind: 'ANNUAL', employeeId: NEWCOMER, year: '2026' },
    })
    const thisYear = await app.request('POST', '/wage-tax-settlements', {
      body: { kind: 'ANNUAL', employeeId: STAYER, year: '2027' },
    })

    expect(stayer.body).toMatchObject({ code: 'WAGE_SETTLEMENT_NOT_APPLICABLE', reason: 'NOT_LEFT_IN_YEAR' })
    expect(leaverAnnual.body).toMatchObject({ reason: 'NOT_EMPLOYED_AT_YEAR_END' })
    expect(newcomer.body).toMatchObject({ reason: 'NOT_EMPLOYED_AT_YEAR_END' })
    expect(thisYear.body).toMatchObject({ reason: 'YEAR_NOT_ENDED' })
    expect(stayer.status).toBe(422)
  })

  it('입력을 고치면 다시 계산하고, 확정하면 퇴사일을 지급일로 채워 그 달 원천세에 알립니다', async () => {
    const updated = await app.request('PATCH', `/wage-tax-settlements/${settlementId}`, {
      body: { input: { otherTaxCredits: 10_000 } },
      ifMatch: '"1"',
    })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ input: { otherTaxCredits: 10_000 }, version: 2 })

    const early = await app.request('PATCH', `/wage-tax-settlements/${settlementId}`, {
      body: { paymentDate: '2025-12-31' },
    })
    expect(early.status).toBe(422)
    expect(early.body).toMatchObject({ code: 'WAGE_SETTLEMENT_PAYMENT_DATE_INVALID', earliestDate: '2026-01-01' })

    const before = events.length
    const completed = await app.request('POST', `/wage-tax-settlements/${settlementId}:complete`, { ifMatch: '"2"' })
    expect(completed.body).toMatchObject({ status: 'COMPLETED', paymentDate: '2026-03-31', allowedActions: ['REOPEN'] })
    expect(events.slice(before)).toMatchObject([
      { type: 'payroll_pay_month.withholding_changed', companyId: TEST_COMPANY_ID, paymentMonth: '2026-03' },
    ])

    const list = await app.request('GET', '/wage-tax-settlements?paymentMonth=2026-03&status=COMPLETED')
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([settlementId])
  })

  it('확정한 정산은 다시 열어야 고치거나 지울 수 있습니다', async () => {
    const update = await app.request('PATCH', `/wage-tax-settlements/${settlementId}`, { body: { input: {} } })
    const remove = await app.request('DELETE', `/wage-tax-settlements/${settlementId}`)
    expect(update.status).toBe(409)
    expect(update.body).toMatchObject({ code: 'WAGE_SETTLEMENT_TRANSITION_INVALID', settlementStatus: 'COMPLETED' })
    expect(remove.status).toBe(409)

    const reopened = await app.request('POST', `/wage-tax-settlements/${settlementId}:reopen`)
    expect(reopened.body).toMatchObject({ status: 'CALCULATED', paymentDate: '2026-03-31' })
    const deleted = await app.request('DELETE', `/wage-tax-settlements/${settlementId}`)
    expect(deleted.status).toBe(204)
    const gone = await app.request('GET', `/wage-tax-settlements/${settlementId}`)
    expect(gone.status).toBe(404)
  })
})

describe('/wage-tax-settlements 연말정산(A04)', () => {
  it('신고한 지급월에 들어가는 확정은 거절합니다', async () => {
    const created = await app.request('POST', '/wage-tax-settlements', {
      body: { kind: 'ANNUAL', employeeId: STAYER, year: '2026', paymentDate: '2027-01-25' },
    })
    expect(created.status).toBe(409)
    expect(created.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: '2027-01' })

    const deferred = await app.request('POST', '/wage-tax-settlements', {
      body: { kind: 'ANNUAL', employeeId: STAYER, year: '2026' },
    })
    expect(deferred.status).toBe(201)
    const completed = await app.request('POST', `/wage-tax-settlements/${deferred.body.id}:complete`)
    expect(completed.body).toMatchObject({ status: 'COMPLETED', paymentDate: '2027-02-28' })
  })

  it('읽기 권한만 있으면 목록은 보지만 만들 수 없습니다', async () => {
    const list = await app.request('GET', '/wage-tax-settlements?year=2026', { token: 'viewer' })
    const create = await app.request('POST', '/wage-tax-settlements', {
      token: 'viewer',
      body: { kind: 'ANNUAL', employeeId: STAYER, year: '2026' },
    })

    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(1)
    expect(create.status).toBe(403)
  })
})
