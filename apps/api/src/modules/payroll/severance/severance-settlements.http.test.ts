import { Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { SqliteDatabase } from '../../../shared/persistence/unit-of-work.ts'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { payrollTestApp } from '../payroll-testing.ts'
import { testEmployee } from '../payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { SeveranceSettlementRepository } from './severance-settlement-repository.ts'
import type { SeveranceSettlementRecord } from './severance-settlement.types.ts'

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

  it('퇴직금을 현행 서비스로 확인한 금액대로 계산합니다', async () => {
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

  it('같은 퇴사에 두 번째 정산은 거절합니다', async () => {
    const response = await app.request('POST', '/severance-settlements', {
      body: { employeeId: LEAVER, input: { threeMonthWages: 9_000_000 } },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'SEVERANCE_SETTLEMENT_EXISTS', settlementId })
  })

  it('퇴사하지 않았거나 퇴직연금에 가입한 직원은 거절합니다', async () => {
    const stayer = await app.request('POST', '/severance-settlements', {
      body: { employeeId: STAYER, input: { threeMonthWages: 9_000_000 } },
    })
    const pension = await app.request('POST', '/severance-settlements', {
      body: { employeeId: DC_MEMBER, input: { threeMonthWages: 9_000_000 } },
    })

    expect(stayer.body).toMatchObject({ code: 'SEVERANCE_NOT_APPLICABLE', reason: 'NOT_LEFT' })
    expect(pension.body).toMatchObject({ code: 'SEVERANCE_NOT_APPLICABLE', reason: 'NOT_SEVERANCE_PAY_PLAN' })
  })

  it('완료하면 다시 열 때까지 입력 변경을 거절합니다', async () => {
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

describe('/severance-settlements 지급일 (원천세 퇴직소득 그 외 A22의 지급월)', () => {
  const OCTOBER_LEAVER = 'emp_01JBQ000000000000000000021' as Id<'employee'>
  const NOVEMBER_LEAVER = 'emp_01JBQ000000000000000000022' as Id<'employee'>
  const EARLY_LEAVER = 'emp_01JBQ000000000000000000023' as Id<'employee'>
  const LEGACY_ID = 'sev_01JBQ0000000000000000000K1' as Id<'severanceSettlement'>
  /** `paymentDate`가 생기기 전에 완료해 저장한 정산입니다. */
  const legacy: SeveranceSettlementRecord = {
    id: LEGACY_ID,
    companyId: TEST_COMPANY_ID,
    employeeId: 'emp_01JBQ000000000000000000024' as Id<'employee'>,
    employeeName: '박예전',
    joinDate: '2024-01-01',
    lastWorkDate: '2026-09-30',
    status: 'COMPLETED',
    input: { threeMonthWages: 9_000_000 },
    result: {
      eligible: true,
      serviceDays: 1_004,
      averageDailyWage: 97_826,
      usedOrdinaryWage: false,
      severancePay: 8_000_000,
      retirementIncomeTax: 70_000,
      localIncomeTax: 7_000,
      netPay: 7_923_000,
      breakdown: [],
    },
    rateTable: '2026-01',
    version: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
  // SQLite로 돌릴 때는 시드도 SQLite 표에 넣어 저장된 JSON에 필드가 없는 경우를 봅니다.
  const tables =
    process.env['SEMU_TEST_STORE'] === 'sqlite'
      ? TableFactory.layerSqlite.pipe(Layer.provide(SqliteDatabase.layer(':memory:')))
      : TableFactory.layerMemory
  const dated = payrollTestApp([
    PayrollEmployeeDirectory.layerMemory([
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: OCTOBER_LEAVER, leaveDate: '2026-10-31' }) },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: NOVEMBER_LEAVER, leaveDate: '2026-10-31' }) },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: EARLY_LEAVER, leaveDate: '2026-10-31' }) },
    ]),
    SeveranceSettlementRepository.layer([legacy]).pipe(Layer.provide(tables)),
  ])
  afterAll(() => dated.dispose())

  const create = (employeeId: Id<'employee'>, paymentDate?: string) =>
    dated.request('POST', '/severance-settlements', {
      body: {
        employeeId,
        input: { threeMonthWages: 9_000_000 },
        ...(paymentDate === undefined ? {} : { paymentDate }),
      },
    })
  const ids = (body: { items: Array<{ id: string }> }) => body.items.map((item) => item.id)
  const dates = (body: { items: Array<{ paymentDate: string | null }> }) =>
    body.items.map((item) => item.paymentDate).sort()

  it('마지막 근무일보다 앞서거나 없는 날짜인 지급일은 거절합니다', async () => {
    const early = await create(EARLY_LEAVER, '2026-10-30')
    expect(early.status).toBe(422)
    expect(early.body).toMatchObject({ code: 'SEVERANCE_PAYMENT_DATE_INVALID', lastWorkDate: '2026-10-31' })

    const malformed = await create(EARLY_LEAVER, '2026-11-31')
    expect(malformed.status).toBe(400)

    // 마지막 근무일 당일은 받습니다(현행 `complete`의 기본값).
    const sameDay = await create(EARLY_LEAVER, '2026-10-31')
    expect(sameDay.status).toBe(201)
    expect(sameDay.body.paymentDate).toBe('2026-10-31')
  })

  it('지급일을 저장하고 계산 상태에서는 바꾸거나 지울 수 있으며 완료할 때 마지막 근무일로 채웁니다', async () => {
    const created = await create(OCTOBER_LEAVER)
    expect(created.status).toBe(201)
    expect(created.body.paymentDate).toBeNull()
    const id = created.body.id

    const moved = await dated.request('PATCH', `/severance-settlements/${id}`, {
      body: { paymentDate: '2026-11-10' },
      ifMatch: '"1"',
    })
    expect(moved.status).toBe(200)
    // 입력이 빠지면 그대로 둡니다.
    expect(moved.body).toMatchObject({ paymentDate: '2026-11-10', input: { threeMonthWages: 9_000_000 }, version: 2 })

    // 지급일이 빠진 수정은 지급일을 그대로 둡니다.
    const inputOnly = await dated.request('PATCH', `/severance-settlements/${id}`, {
      body: { input: { threeMonthWages: 9_300_000 } },
    })
    expect(inputOnly.status).toBe(200)
    expect(inputOnly.body).toMatchObject({ paymentDate: '2026-11-10', input: { threeMonthWages: 9_300_000 } })

    const early = await dated.request('PATCH', `/severance-settlements/${id}`, { body: { paymentDate: '2026-10-01' } })
    expect(early.status).toBe(422)
    expect(early.body.code).toBe('SEVERANCE_PAYMENT_DATE_INVALID')

    const cleared = await dated.request('PATCH', `/severance-settlements/${id}`, { body: { paymentDate: null } })
    expect(cleared.body.paymentDate).toBeNull()

    const completed = await dated.request('POST', `/severance-settlements/${id}:complete`)
    expect(completed.body).toMatchObject({ status: 'COMPLETED', paymentDate: '2026-10-31' })

    // 완료한 정산의 지급일은 다시 열어야 바꿉니다. 다시 열어도 지급일은 남습니다.
    const locked = await dated.request('PATCH', `/severance-settlements/${id}`, { body: { paymentDate: '2026-11-10' } })
    expect(locked.status).toBe(409)
    const reopened = await dated.request('POST', `/severance-settlements/${id}:reopen`)
    expect(reopened.body).toMatchObject({ status: 'CALCULATED', paymentDate: '2026-10-31' })
    await dated.request('PATCH', `/severance-settlements/${id}`, { body: { paymentDate: '2026-11-10' } })
    const again = await dated.request('POST', `/severance-settlements/${id}:complete`)
    expect(again.body).toMatchObject({ status: 'COMPLETED', paymentDate: '2026-11-10' })
  })

  it('지급월과 상태로 목록을 보여 주고 지급일이 없는 정산은 뺍니다', async () => {
    const calculated = await create(NOVEMBER_LEAVER, '2026-11-25')
    expect(calculated.status).toBe(201)

    const november = await dated.request('GET', '/severance-settlements?paymentMonth=2026-11')
    expect(november.status).toBe(200)
    expect(dates(november.body)).toEqual(['2026-11-10', '2026-11-25'])

    // 원천세 요약은 완료된 정산만 셉니다.
    const completed = await dated.request('GET', '/severance-settlements?paymentMonth=2026-11&status=COMPLETED')
    expect(completed.body.items).toHaveLength(1)
    expect(completed.body.items[0]).toMatchObject({ status: 'COMPLETED', paymentDate: '2026-11-10' })
    expect(ids(completed.body)).not.toContain(calculated.body.id)

    const october = await dated.request('GET', '/severance-settlements?paymentMonth=2026-10')
    expect(dates(october.body)).toEqual(['2026-10-31'])

    const invalid = await dated.request('GET', '/severance-settlements?paymentMonth=2026-13')
    expect(invalid.status).toBe(400)
  })

  it('paymentDate 도입 전에 저장한 정산도 읽되 어느 지급월 목록에도 넣지 않습니다', async () => {
    const read = await dated.request('GET', `/severance-settlements/${LEGACY_ID}`)
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({ status: 'COMPLETED', paymentDate: null, allowedActions: ['REOPEN'] })

    const all = await dated.request('GET', '/severance-settlements?status=COMPLETED')
    expect(ids(all.body)).toContain(LEGACY_ID)
    const september = await dated.request('GET', '/severance-settlements?paymentMonth=2026-09')
    expect(ids(september.body)).toEqual([])

    // 다시 열고 완료하면 마지막 근무일이 지급일이 되어 그 달에 듭니다.
    await dated.request('POST', `/severance-settlements/${LEGACY_ID}:reopen`, { ifMatch: '"3"' })
    const completed = await dated.request('POST', `/severance-settlements/${LEGACY_ID}:complete`, { ifMatch: '"4"' })
    expect(completed.body).toMatchObject({ status: 'COMPLETED', paymentDate: '2026-09-30', version: 5 })
    const after = await dated.request('GET', '/severance-settlements?paymentMonth=2026-09&status=COMPLETED')
    expect(ids(after.body)).toEqual([LEGACY_ID])
  })
})
