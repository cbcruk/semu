import { Effect, Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { SqliteDatabase } from '../../../shared/persistence/unit-of-work.ts'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { clockAt, payrollTestApp } from '../payroll-testing.ts'
import { testEmployee } from '../payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayrollEventPublisher } from '../ports/payroll-events.ts'
import type { PayrollEvent } from '../ports/payroll-events.types.ts'
import { WithholdingFilingLock } from '../ports/withholding-filing-lock.ts'
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
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: legacy.employeeId, leaveDate: legacy.lastWorkDate }) },
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

describe('/severance-settlements 원천세 연계 (지급월 신호와 신고 잠금)', () => {
  const OCTOBER_LEAVER = 'emp_01JBQ000000000000000000031' as Id<'employee'>
  const DECEMBER_LEAVER = 'emp_01JBQ000000000000000000032' as Id<'employee'>
  const FILED_COMPLETED_ID = 'sev_01JBQ0000000000000000000M1' as Id<'severanceSettlement'>
  const FILED_CALCULATED_ID = 'sev_01JBQ0000000000000000000M2' as Id<'severanceSettlement'>
  const FILED_COMPLETED_EMPLOYEE = 'emp_01JBQ000000000000000000033' as Id<'employee'>
  const FILED_CALCULATED_EMPLOYEE = 'emp_01JBQ000000000000000000034' as Id<'employee'>
  /** 원천세가 신고된 지급월입니다. */
  const FILED_MONTH = '2026-12'
  const base = (
    id: Id<'severanceSettlement'>,
    employeeId: Id<'employee'>,
    status: 'CALCULATED' | 'COMPLETED',
  ): SeveranceSettlementRecord => ({
    id,
    companyId: TEST_COMPANY_ID,
    employeeId,
    employeeName: '정신고',
    joinDate: '2024-01-01',
    lastWorkDate: '2026-11-30',
    paymentDate: '2026-12-05',
    status,
    input: { threeMonthWages: 9_000_000 },
    result: {
      eligible: true,
      serviceDays: 1_065,
      averageDailyWage: 97_826,
      usedOrdinaryWage: false,
      severancePay: 8_500_000,
      retirementIncomeTax: 80_000,
      localIncomeTax: 8_000,
      netPay: 8_412_000,
      breakdown: [],
    },
    rateTable: '2026-01',
    version: 1,
    createdAt: '2026-12-01T00:00:00.000Z',
    updatedAt: '2026-12-01T00:00:00.000Z',
  })
  const events: PayrollEvent[] = []
  const linked = payrollTestApp([
    PayrollEmployeeDirectory.layerMemory([
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: OCTOBER_LEAVER, leaveDate: '2026-10-31' }) },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: DECEMBER_LEAVER, leaveDate: '2026-12-01' }) },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: FILED_COMPLETED_EMPLOYEE, leaveDate: '2026-11-30' }) },
      {
        companyId: TEST_COMPANY_ID,
        employee: testEmployee({ id: FILED_CALCULATED_EMPLOYEE, leaveDate: '2026-11-30' }),
      },
    ]),
    SeveranceSettlementRepository.layer([
      base(FILED_COMPLETED_ID, FILED_COMPLETED_EMPLOYEE, 'COMPLETED'),
      base(FILED_CALCULATED_ID, FILED_CALCULATED_EMPLOYEE, 'CALCULATED'),
    ]).pipe(Layer.provide(TableFactory.layerMemory)),
    WithholdingFilingLock.layerMemory([{ companyId: TEST_COMPANY_ID, paymentMonth: FILED_MONTH }]),
    PayrollEventPublisher.layerMemory(events),
  ])
  afterAll(() => linked.dispose())

  const changedMonths = () =>
    events.splice(0).map((event) => {
      expect(event).toEqual({
        type: 'payroll_pay_month.withholding_changed',
        eventId: expect.any(String),
        companyId: TEST_COMPANY_ID,
        paymentMonth: expect.any(String),
        occurredAt: expect.any(String),
      })
      return event.paymentMonth
    })

  it('완료·다시 열기 때 그 지급월의 원천세가 바뀌었다고 알리고, 계산됨 정산의 변경은 알리지 않습니다', async () => {
    const created = await linked.request('POST', '/severance-settlements', {
      body: { employeeId: OCTOBER_LEAVER, input: { threeMonthWages: 9_000_000 }, paymentDate: '2026-10-31' },
    })
    expect(created.status).toBe(201)
    const id = created.body.id
    expect(changedMonths()).toEqual([])

    await linked.request('POST', `/severance-settlements/${id}:complete`)
    expect(changedMonths()).toEqual(['2026-10'])

    await linked.request('POST', `/severance-settlements/${id}:reopen`)
    expect(changedMonths()).toEqual(['2026-10'])

    // 지급일 이동은 다시 열기(옛 달)와 완료(새 달)로 두 달 모두에 알립니다. 계산됨에서 옮기는 것만으로는 합계가 그대로입니다.
    const moved = await linked.request('PATCH', `/severance-settlements/${id}`, { body: { paymentDate: '2026-11-10' } })
    expect(moved.status).toBe(200)
    expect(changedMonths()).toEqual([])
    await linked.request('POST', `/severance-settlements/${id}:complete`)
    expect(changedMonths()).toEqual(['2026-11'])

    // 제외·제외 취소는 계산됨에서만 하므로 합계와 상관없습니다.
    await linked.request('POST', `/severance-settlements/${id}:reopen`)
    events.splice(0)
    await linked.request('POST', `/severance-settlements/${id}:exclude`, { body: { reason: '중복' } })
    await linked.request('POST', `/severance-settlements/${id}:include`)
    expect(changedMonths()).toEqual([])
  })

  it('원천세가 신고된 지급월의 정산은 다시 열거나 완료할 수 없습니다(409)', async () => {
    const reopen = await linked.request('POST', `/severance-settlements/${FILED_COMPLETED_ID}:reopen`)
    expect(reopen.status).toBe(409)
    expect(reopen.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: FILED_MONTH })

    const complete = await linked.request('POST', `/severance-settlements/${FILED_CALCULATED_ID}:complete`)
    expect(complete.status).toBe(409)
    expect(complete.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: FILED_MONTH })

    const unchanged = await linked.request('GET', `/severance-settlements/${FILED_COMPLETED_ID}`)
    expect(unchanged.body).toMatchObject({ status: 'COMPLETED', version: 1 })
    expect(changedMonths()).toEqual([])
  })

  it('지급일을 신고된 지급월로 정하거나 옮길 수 없습니다(409)', async () => {
    const createdInto = await linked.request('POST', '/severance-settlements', {
      body: { employeeId: DECEMBER_LEAVER, input: { threeMonthWages: 9_000_000 }, paymentDate: '2026-12-15' },
    })
    expect(createdInto.status).toBe(409)
    expect(createdInto.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: FILED_MONTH })

    const created = await linked.request('POST', '/severance-settlements', {
      body: { employeeId: DECEMBER_LEAVER, input: { threeMonthWages: 9_000_000 }, paymentDate: '2027-01-05' },
    })
    expect(created.status).toBe(201)
    const movedInto = await linked.request('PATCH', `/severance-settlements/${created.body.id}`, {
      body: { paymentDate: '2026-12-20' },
    })
    expect(movedInto.status).toBe(409)
    expect(movedInto.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: FILED_MONTH })

    // 마지막 근무일(2026-12-01)로 채우는 완료도 신고된 달로 들이는 것입니다.
    const cleared = await linked.request('PATCH', `/severance-settlements/${created.body.id}`, {
      body: { paymentDate: null },
    })
    expect(cleared.status).toBe(200)
    const completedInto = await linked.request('POST', `/severance-settlements/${created.body.id}:complete`)
    expect(completedInto.status).toBe(409)
    expect(completedInto.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: FILED_MONTH })

    // 같은 달 안의 입력 수정은 원천세와 상관없어 받습니다.
    const inputOnly = await linked.request('PATCH', `/severance-settlements/${FILED_CALCULATED_ID}`, {
      body: { input: { threeMonthWages: 9_300_000 } },
    })
    expect(inputOnly.status).toBe(200)
    expect(changedMonths()).toEqual([])
  })

  it('계산됨 정산은 신고된 지급월에서 빼내거나 지급일을 지울 수 있습니다', async () => {
    // 합계에 들지 않으므로 신고와 어긋나지 않고, 막으면 그 정산은 완료도 이동도 못 합니다.
    const cleared = await linked.request('PATCH', `/severance-settlements/${FILED_CALCULATED_ID}`, {
      body: { paymentDate: null },
    })
    expect(cleared.status).toBe(200)
    expect(cleared.body.paymentDate).toBeNull()

    const into = await linked.request('PATCH', `/severance-settlements/${FILED_CALCULATED_ID}`, {
      body: { paymentDate: '2026-12-20' },
    })
    expect(into.status).toBe(409)

    const movedOut = await linked.request('PATCH', `/severance-settlements/${FILED_CALCULATED_ID}`, {
      body: { paymentDate: '2027-01-05' },
    })
    expect(movedOut.status).toBe(200)
    const completed = await linked.request('POST', `/severance-settlements/${FILED_CALCULATED_ID}:complete`)
    expect(completed.status).toBe(200)
    expect(changedMonths()).toEqual(['2027-01'])
  })
})

describe('/severance-settlements HR 퇴직일 대조 (목록은 HR에 한 번 묻기)', () => {
  const MATCHED = 'emp_01JBQ000000000000000000041' as Id<'employee'>
  const RE_RESIGNED = 'emp_01JBQ000000000000000000042' as Id<'employee'>
  const CANCELLED = 'emp_01JBQ000000000000000000043' as Id<'employee'>
  const DELETED = 'emp_01JBQ000000000000000000044' as Id<'employee'>
  const record = (suffix: string, employeeId: Id<'employee'>): SeveranceSettlementRecord => ({
    id: `sev_01JBQ0000000000000000000P${suffix}` as Id<'severanceSettlement'>,
    companyId: TEST_COMPANY_ID,
    employeeId,
    employeeName: '김대조',
    joinDate: '2024-01-01',
    lastWorkDate: '2026-10-31',
    status: 'CALCULATED',
    input: { threeMonthWages: 9_000_000 },
    result: {
      eligible: true,
      serviceDays: 1_035,
      averageDailyWage: 97_826,
      usedOrdinaryWage: false,
      severancePay: 8_321_917,
      retirementIncomeTax: 79_720,
      localIncomeTax: 7_970,
      netPay: 8_234_227,
      breakdown: [],
    },
    rateTable: '2026-01',
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  })
  const calls = { leaveDatesOf: 0, find: 0 }
  /** HR 조회 횟수를 세는 명부입니다. */
  const counting = Layer.effect(
    PayrollEmployeeDirectory,
    Effect.gen(function* () {
      const inner = yield* PayrollEmployeeDirectory
      return PayrollEmployeeDirectory.of({
        ...inner,
        leaveDatesOf: (companyId, employeeIds) =>
          Effect.sync(() => calls.leaveDatesOf++).pipe(Effect.andThen(inner.leaveDatesOf(companyId, employeeIds))),
        find: (companyId, employeeId, asOf) =>
          Effect.sync(() => calls.find++).pipe(Effect.andThen(inner.find(companyId, employeeId, asOf))),
      })
    }),
  ).pipe(
    Layer.provide(
      PayrollEmployeeDirectory.layerMemory([
        { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: MATCHED, leaveDate: '2026-10-31' }) },
        { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: RE_RESIGNED, leaveDate: '2026-11-30' }) },
        { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: CANCELLED }) },
      ]),
    ),
  )
  const checked = payrollTestApp([
    counting,
    SeveranceSettlementRepository.layer([
      record('1', MATCHED),
      record('2', RE_RESIGNED),
      record('3', CANCELLED),
      record('4', DELETED),
      // 같은 직원의 정산이 둘이어도 한 번에 묻습니다.
      { ...record('5', MATCHED), status: 'EXCLUDED' },
    ]).pipe(Layer.provide(TableFactory.layerMemory)),
  ])
  afterAll(() => checked.dispose())

  it('직원이 여럿인 목록도 HR에 한 번만 묻고 정산마다 어긋남을 붙입니다', async () => {
    calls.leaveDatesOf = 0
    calls.find = 0

    const list = await checked.request('GET', '/severance-settlements')

    expect(list.status).toBe(200)
    expect(calls).toEqual({ leaveDatesOf: 1, find: 0 })
    const mismatchOf = Object.fromEntries(
      list.body.items.map((item: { id: string; retirementMismatch: string | null }) => [
        item.id.slice(-1),
        item.retirementMismatch,
      ]),
    )
    expect(mismatchOf).toEqual({
      '1': null,
      '2': 'LEAVE_DATE_CHANGED',
      '3': 'NOT_LEFT',
      '4': 'EMPLOYEE_NOT_FOUND',
      '5': null,
    })
  })

  it('상세와 완료도 퇴직일만 묻고 어긋나면 완료를 거절합니다', async () => {
    calls.leaveDatesOf = 0
    calls.find = 0

    const detail = await checked.request('GET', '/severance-settlements/sev_01JBQ0000000000000000000P2')
    const completed = await checked.request('POST', '/severance-settlements/sev_01JBQ0000000000000000000P2:complete')
    const matched = await checked.request('POST', '/severance-settlements/sev_01JBQ0000000000000000000P1:complete')

    expect(detail.body).toMatchObject({
      retirementMismatch: 'LEAVE_DATE_CHANGED',
      allowedActions: ['UPDATE', 'EXCLUDE'],
    })
    expect(completed.status).toBe(409)
    expect(completed.body).toMatchObject({
      code: 'SEVERANCE_RETIREMENT_MISMATCH',
      reason: 'LEAVE_DATE_CHANGED',
      lastWorkDate: '2026-10-31',
      leaveDate: '2026-11-30',
    })
    expect(matched.body).toMatchObject({ status: 'COMPLETED', retirementMismatch: null })
    expect(calls).toEqual({ leaveDatesOf: 3, find: 0 })
  })

  it('정산이 없으면 HR에 묻지 않습니다', async () => {
    calls.leaveDatesOf = 0

    const list = await checked.request('GET', '/severance-settlements?paymentMonth=2030-01')

    expect(list.body.items).toEqual([])
    expect(calls.leaveDatesOf).toBe(0)
  })
})

describe('/severance-settlements 중간정산과 기산일', () => {
  const WORKER = 'emp_01JBQ000000000000000000021' as Id<'employee'>
  const NEWBIE = 'emp_01JBQ000000000000000000022' as Id<'employee'>
  const LEFT_A = 'emp_01JBQ000000000000000000023' as Id<'employee'>
  const interimApp = payrollTestApp([
    clockAt('2026-11-14T10:00:00+09:00'),
    PayrollEmployeeDirectory.layerMemory([
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: WORKER }) },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: NEWBIE, joinDate: '2026-06-01' }) },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: LEFT_A, leaveDate: '2026-09-30' }) },
    ]),
  ])
  afterAll(() => interimApp.dispose())

  const createInterim = (employeeId: string, settlementDate: string, interimReason = 'HOME_PURCHASE') =>
    interimApp.request('POST', '/severance-settlements', {
      body: { kind: 'INTERIM', employeeId, settlementDate, interimReason, input: { threeMonthWages: 9_000_000 } },
    })
  const run = (id: string, command: 'complete' | 'reopen') =>
    interimApp.request('POST', `/severance-settlements/${id}:${command}`)

  let firstId = ''
  let secondId = ''

  it('재직 중인 직원의 중간정산은 입사일부터 기준일까지를 정산합니다', async () => {
    const response = await createInterim(WORKER, '2026-01-31', 'RENT_DEPOSIT')

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      kind: 'INTERIM',
      interimReason: 'RENT_DEPOSIT',
      joinDate: '2024-01-01',
      serviceStartDate: '2024-01-01',
      lastWorkDate: '2026-01-31',
      status: 'CALCULATED',
      retirementMismatch: null,
      result: { eligible: true, serviceDays: 762 },
      allowedActions: ['UPDATE', 'COMPLETE', 'EXCLUDE'],
    })
    firstId = response.body.id
  })

  it('계산됨 정산이 있으면 다음 중간정산은 409이고, 완료하면 그 기준일 다음 날부터 받습니다', async () => {
    expect((await createInterim(WORKER, '2026-06-30')).body).toMatchObject({
      code: 'SEVERANCE_SETTLEMENT_EXISTS',
      settlementId: firstId,
    })
    expect((await run(firstId, 'complete')).body.status).toBe('COMPLETED')

    for (const date of ['2026-01-31', '2026-11-15']) {
      const response = await createInterim(WORKER, date)
      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({
        code: 'SEVERANCE_INTERIM_DATE_INVALID',
        earliestDate: '2026-02-01',
        latestDate: '2026-11-14',
      })
    }
  })

  it('전세금·보증금 사유는 한 번만 받습니다', async () => {
    const response = await createInterim(WORKER, '2026-06-30', 'RENT_DEPOSIT')

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'SEVERANCE_NOT_APPLICABLE', reason: 'RENT_DEPOSIT_ALREADY_USED' })
  })

  it('다음 중간정산은 앞 중간정산 다음 날부터 근속일수를 셉니다', async () => {
    const response = await createInterim(WORKER, '2026-06-30')

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      serviceStartDate: '2026-02-01',
      result: { eligible: true, serviceDays: 150 },
    })
    secondId = response.body.id
  })

  it('늦은 정산이 완료돼 있으면 앞 중간정산을 다시 열거나 완료할 수 없습니다', async () => {
    expect((await run(secondId, 'complete')).body.status).toBe('COMPLETED')

    const reopened = await run(firstId, 'reopen')

    expect(reopened.status).toBe(409)
    expect(reopened.body).toMatchObject({ code: 'SEVERANCE_LATER_SETTLEMENT_COMPLETED', settlementId: secondId })
  })

  it('앞 중간정산이 취소돼 기산일이 바뀌면 다시 계산하기 전에는 완료할 수 없습니다', async () => {
    expect((await run(secondId, 'reopen')).body.status).toBe('CALCULATED')
    expect((await run(firstId, 'reopen')).body.status).toBe('CALCULATED')

    const completed = await run(secondId, 'complete')
    expect(completed.status).toBe(409)
    expect(completed.body).toMatchObject({ code: 'SEVERANCE_SERVICE_START_CHANGED', serviceStartDate: '2024-01-01' })

    const second = await interimApp.request('GET', `/severance-settlements/${secondId}`)
    const recalculated = await interimApp.request('PATCH', `/severance-settlements/${secondId}`, {
      headers: { 'if-match': second.headers.get('etag') ?? '' },
      body: {},
    })
    expect(recalculated.body).toMatchObject({ serviceStartDate: '2024-01-01', result: { serviceDays: 912 } })
    expect((await run(secondId, 'complete')).body.status).toBe('COMPLETED')

    const first = await run(firstId, 'complete')
    expect(first.status).toBe(409)
    expect(first.body).toMatchObject({ code: 'SEVERANCE_LATER_SETTLEMENT_COMPLETED', settlementId: secondId })
  })

  it('근속 1년 미만이거나 이미 퇴사한 직원은 중간정산할 수 없습니다', async () => {
    const newbie = await createInterim(NEWBIE, '2026-10-31')
    const left = await createInterim(LEFT_A, '2026-06-30')

    expect(newbie.body).toMatchObject({ code: 'SEVERANCE_NOT_APPLICABLE', reason: 'SERVICE_UNDER_ONE_YEAR' })
    expect(left.body).toMatchObject({ code: 'SEVERANCE_NOT_APPLICABLE', reason: 'ALREADY_LEFT' })
  })
})

describe('/severance-settlement-candidates', () => {
  const LEFT_A = 'emp_01JBQ000000000000000000031' as Id<'employee'>
  const SETTLED = 'emp_01JBQ000000000000000000032' as Id<'employee'>
  const SHORT = 'emp_01JBQ000000000000000000033' as Id<'employee'>
  const OLD = 'emp_01JBQ000000000000000000034' as Id<'employee'>
  const PENSION = 'emp_01JBQ000000000000000000035' as Id<'employee'>
  const WORKING = 'emp_01JBQ000000000000000000036' as Id<'employee'>
  const candidateApp = payrollTestApp([
    clockAt('2026-11-14T10:00:00+09:00'),
    PayrollEmployeeDirectory.layerMemory([
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: LEFT_A, leaveDate: '2026-09-30' }) },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: SETTLED, leaveDate: '2026-08-31' }) },
      {
        companyId: TEST_COMPANY_ID,
        employee: testEmployee({ id: SHORT, joinDate: '2026-03-01', leaveDate: '2026-10-31' }),
      },
      {
        companyId: TEST_COMPANY_ID,
        employee: testEmployee({ id: OLD, joinDate: '2020-01-01', leaveDate: '2023-06-30' }),
      },
      {
        companyId: TEST_COMPANY_ID,
        employee: testEmployee({ id: PENSION, leaveDate: '2026-09-30', retirementBenefitType: 'DEFINED_CONTRIBUTION' }),
      },
      { companyId: TEST_COMPANY_ID, employee: testEmployee({ id: WORKING }) },
    ]),
  ])
  afterAll(() => candidateApp.dispose())

  it('3년 안에 퇴사한 퇴직금 제도 직원 중 정산이 없는 직원을 퇴직일 순으로 보여 줍니다', async () => {
    const settled = await candidateApp.request('POST', '/severance-settlements', {
      body: { employeeId: SETTLED, input: { threeMonthWages: 9_000_000 } },
    })
    expect(settled.status).toBe(201)

    const response = await candidateApp.request('GET', '/severance-settlement-candidates')

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([
      {
        employeeId: LEFT_A,
        employeeName: expect.any(String),
        joinDate: '2024-01-01',
        leaveDate: '2026-09-30',
        serviceStartDate: '2024-01-01',
        eligible: true,
      },
      expect.objectContaining({ employeeId: SHORT, leaveDate: '2026-10-31', eligible: false }),
    ])
  })

  it('기간을 넓히면 오래된 퇴사자도 보여 주고, 정산을 제외하면 다시 후보입니다', async () => {
    const all = await candidateApp.request('GET', '/severance-settlement-candidates?from=2020-01-01')
    expect(all.body.items.map((item: { employeeId: string }) => item.employeeId)).toEqual([OLD, LEFT_A, SHORT])

    const list = await candidateApp.request('GET', '/severance-settlements')
    const settled = list.body.items.find((item: { employeeId: string }) => item.employeeId === SETTLED)
    await candidateApp.request('POST', `/severance-settlements/${settled.id}:exclude`, {
      body: { reason: '다시 계산' },
    })
    const after = await candidateApp.request('GET', '/severance-settlement-candidates?from=2026-08-01&to=2026-08-31')
    expect(after.body.items.map((item: { employeeId: string }) => item.employeeId)).toEqual([SETTLED])
  })
})
