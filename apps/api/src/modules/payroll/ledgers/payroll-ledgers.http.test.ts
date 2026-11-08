import { afterAll, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { AGENCY_TOKEN, clockAt, payrollTestApp } from '../payroll-testing.ts'
import { PayrollEmployeeDirectory, type PayrollEmployee } from '../ports/payroll-employee-directory.ts'
import { PayrollEventPublisher } from '../ports/payroll-events.ts'
import type { PayrollEvent } from '../ports/payroll-events.types.ts'
import { WithholdingFilingLock } from '../ports/withholding-filing-lock.ts'
import { defaultPayrollSetting } from '../settings/payroll-setting.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'
import { PayrollLedgerRepository } from './payroll-ledger-repository.ts'
import type { PayrollLedgerRecord } from './payroll-ledger.types.ts'

const DIRECT_COMPANY_ID = 'cmp_01JBQ000000000000000000002' as Id<'company'>
const EMPLOYEE_ID = 'emp_01JBQ000000000000000000009' as Id<'employee'>
/** `DIRECT_COMPANY_ID`에만 있는 직원입니다. 이미 퇴사해 그 회사의 근로 행 후보에도 들지 않습니다. */
const FOREIGN_EMPLOYEE_ID = 'emp_01JBQ000000000000000000010' as Id<'employee'>

const employee: PayrollEmployee = {
  id: EMPLOYEE_ID,
  name: '김하나',
  registrationNumberMasked: '900101-1******',
  email: 'hana@example.com',
  departmentName: null,
  joinDate: '2024-01-01',
  leaveDate: null,
  paymentUnit: 'MONTHLY',
  basePay: 3_000_000,
  hourlyWage: 0,
  dailyWage: 0,
  monthlyStandardHours: 209,
  dailyRestMinutes: 480,
  socialInsurance: { nationalPension: true, healthInsurance: true, employmentInsurance: true },
  incomeTax: {
    dependants: 1,
    childrenAged8To20: 0,
    childcareChildren: null,
    withholdingRatePpm: 1_000_000,
    manualAmount: null,
  },
  retirementBenefitType: 'SEVERANCE_PAY',
}

const rateMethods = {
  ...defaultPayrollSetting(),
  deductionMethods: {
    nationalPension: 'RATE',
    healthInsurance: 'RATE',
    employmentInsurance: 'RATE',
    incomeTax: 'TAX_TABLE',
  },
} as const

const events: PayrollEvent[] = []

/** 테스트의 오늘입니다. 추가 대장(2027-03)이 원천세 기한에 막히지 않도록 벽시계 대신 이 날짜에 둡니다. */
const TODAY = '2026-11-07T00:00:00+09:00'

const app = payrollTestApp(
  [
    PayrollEmployeeDirectory.layerMemory([
      { companyId: TEST_COMPANY_ID, employee },
      { companyId: DIRECT_COMPANY_ID, employee },
      {
        companyId: DIRECT_COMPANY_ID,
        employee: { ...employee, id: FOREIGN_EMPLOYEE_ID, name: '남회사', leaveDate: '2024-06-30' },
      },
    ]),
    PayrollSettingRepository.layerMemory([
      { companyId: TEST_COMPANY_ID, setting: { ...rateMethods, workflow: 'CLIENT_APPROVAL' } },
      { companyId: DIRECT_COMPANY_ID, setting: rateMethods },
    ]),
    PayrollEventPublisher.layerMemory(events),
    clockAt(TODAY),
  ],
  [
    ['direct', testActor({ companyId: DIRECT_COMPANY_ID })],
    ['viewer', testActor({ permissions: new Set(['payroll-ledger:read']) })],
  ],
)

afterAll(() => app.dispose())

describe('/payroll-ledgers 급여 아웃소싱(고객 승인)', () => {
  let ledgerId = ''
  let rowId = ''

  it('인사 정보로 근로소득 행을 채운 정기 대장을 만듭니다', async () => {
    const response = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2026-03' } })

    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(response.body).toMatchObject({
      kind: 'REGULAR',
      workflow: 'CLIENT_APPROVAL',
      status: 'DRAFT',
      step: 1,
      title: '2026년 3월 급여',
      paymentDate: '2026-03-25',
      wagePeriod: { start: '2026-03-01', end: '2026-03-31' },
      rowCount: 1,
      allowedActions: ['SUBMIT', 'EDIT_ROWS', 'RECALCULATE', 'DELETE'],
    })
    ledgerId = response.body.id
    const rows = await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)
    rowId = rows.body.items[0].id
    expect(rows.body.items[0]).toMatchObject({ employeeId: EMPLOYEE_ID, incomeType: 'WAGE_MONTHLY' })
  })

  it('행을 현행 서비스로 확인한 금액대로 다시 계산합니다', async () => {
    const response = await app.request('PATCH', `/payroll-ledgers/${ledgerId}/rows/${rowId}`, {
      headers: { 'if-match': '"1"' },
      body: {
        input: {
          incomeType: 'WAGE_MONTHLY',
          basePay: 3_000_000,
          paymentItems: [{ code: 'MEAL', name: '식대', amount: 200_000, nonTaxableCategory: 'MEAL' }],
        },
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"2"')
    expect(response.body.result).toMatchObject({ grossPay: 3_200_000, incomeTax: 60_380, netPay: 2_842_070 })
  })

  it('같은 직원·귀속월의 두 번째 근로소득 행은 거절합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { employeeId: EMPLOYEE_ID, input: { incomeType: 'WAGE_MONTHLY', basePay: 100_000 } },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'WAGE_INCOME_DUPLICATED', ledgerId })
  })

  it('오래된 If-Match는 거절합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}:submit`, {
      headers: { 'if-match': '"1"' },
    })

    expect(response.status).toBe(412)
    expect(response.body).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 2 })
  })

  it('제출·승인 요청·반려·승인을 차례로 거칩니다', async () => {
    const submitted = await app.request('POST', `/payroll-ledgers/${ledgerId}:submit`)
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', step: 2, allowedActions: [] })

    const byClient = await app.request('POST', `/payroll-ledgers/${ledgerId}:request-approval`)
    expect(byClient.status).toBe(409)
    expect(byClient.body).toMatchObject({ code: 'PAYROLL_LEDGER_TRANSITION_INVALID', ledgerStatus: 'SUBMITTED' })

    const requested = await app.request('POST', `/payroll-ledgers/${ledgerId}:request-approval`, {
      token: AGENCY_TOKEN,
    })
    expect(requested.body).toMatchObject({ status: 'PENDING_APPROVAL' })

    const rejected = await app.request('POST', `/payroll-ledgers/${ledgerId}:reject`, { body: { reason: '식대 확인' } })
    expect(rejected.body).toMatchObject({ status: 'SUBMITTED', rejection: { reason: '식대 확인' } })

    await app.request('POST', `/payroll-ledgers/${ledgerId}:request-approval`, { token: AGENCY_TOKEN })
    const approved = await app.request('POST', `/payroll-ledgers/${ledgerId}:approve`)
    expect(approved.body).toMatchObject({ status: 'CLOSED', step: 3, rejection: null, allowedActions: ['REOPEN'] })
  })

  it('지급월 마감 이벤트는 원천세 금액 없이 회사·지급월·대장만 싣습니다', () => {
    const closed = events.at(-1)

    expect(closed).toMatchObject({
      type: 'payroll_pay_month.closed',
      companyId: TEST_COMPANY_ID,
      paymentMonth: '2026-03',
      ledgerIds: [ledgerId],
    })
    expect(closed).not.toHaveProperty('withholding')
  })

  it('마감한 급여대장은 읽기만 할 수 있습니다', async () => {
    const response = await app.request('DELETE', `/payroll-ledgers/${ledgerId}/rows/${rowId}`)

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'PAYROLL_LEDGER_READ_ONLY', ledgerStatus: 'CLOSED' })
  })

  it('급여대장을 다시 열면 지급월도 다시 엽니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}:reopen`, { body: { reason: '상여 누락' } })

    expect(response.body).toMatchObject({ status: 'SUBMITTED', reopenReason: '상여 누락', closedAt: null })
    expect(events.at(-1)).toMatchObject({ type: 'payroll_pay_month.reopened', paymentMonth: '2026-03' })
  })

  it('귀속월별로 급여대장을 보여 줍니다', async () => {
    const response = await app.request('GET', '/payroll-ledgers?attributionMonth=2026-03')

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
  })

  it('행을 바꾸려면 수정 권한이 있어야 합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}:recalculate`, { token: 'viewer' })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'payroll-ledger:update' })
  })
})

describe('/payroll-ledgers 추가 대장', () => {
  let regularId = ''
  let additionalId = ''

  it('정기 대장을 제출하기 전에는 추가 대장을 만들지 못합니다', async () => {
    const regular = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2027-03' } })
    regularId = regular.body.id

    const blocked = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2027-03' } })

    expect(blocked.status).toBe(409)
    expect(blocked.body).toMatchObject({ code: 'ADDITIONAL_LEDGER_BLOCKED', reason: 'REGULAR_LEDGER_NOT_SUBMITTED' })
  })

  it('추가 대장은 사업소득은 받고 근로소득은 받지 않습니다', async () => {
    await app.request('POST', `/payroll-ledgers/${regularId}:submit`)
    const additional = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2027-03' } })
    expect(additional.status).toBe(201)
    expect(additional.body).toMatchObject({ kind: 'ADDITIONAL', title: '2027년 3월 추가 급여', rowCount: 0 })
    additionalId = additional.body.id

    const wage = await app.request('POST', `/payroll-ledgers/${additionalId}/rows`, {
      body: { employeeId: EMPLOYEE_ID, input: { incomeType: 'WAGE_MONTHLY', basePay: 100_000 } },
    })
    expect(wage.status).toBe(409)
    expect(wage.body).toMatchObject({ code: 'WAGE_ROW_ON_ADDITIONAL_LEDGER' })

    const business = await app.request('POST', `/payroll-ledgers/${additionalId}/rows`, {
      body: { payeeName: '박프리', input: { incomeType: 'BUSINESS', payAmount: 1_000_000 } },
    })
    expect(business.status).toBe(201)
    expect(business.body.result).toMatchObject({
      grossPay: 1_000_000,
      incomeTax: 30_000,
      localIncomeTax: 3_000,
      netPay: 967_000,
    })
  })

  it('근로소득이 아닌 행에는 수령인 이름이 있어야 합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${additionalId}/rows`, {
      body: { input: { incomeType: 'OTHER', payAmount: 500_000 } },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'PAYROLL_ROW_PAYEE_INVALID', reason: 'PAYEE_NAME_REQUIRED' })
  })

  it('근로소득이 아닌 행을 다른 회사 직원에 잇는 것은 거절합니다', async () => {
    const foreign = await app.request('POST', `/payroll-ledgers/${additionalId}/rows`, {
      body: {
        employeeId: FOREIGN_EMPLOYEE_ID,
        payeeName: '남회사',
        input: { incomeType: 'BUSINESS', payAmount: 100_000 },
      },
    })
    expect(foreign.status).toBe(422)
    expect(foreign.body).toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' })

    const own = await app.request('POST', `/payroll-ledgers/${additionalId}/rows`, {
      body: { employeeId: EMPLOYEE_ID, payeeName: '김하나', input: { incomeType: 'BUSINESS', payAmount: 100_000 } },
    })
    expect(own.status).toBe(201)
  })

  it('추가 대장이 있으면 정기 대장을 지우지 못합니다', async () => {
    await app.request('POST', `/payroll-ledgers/${regularId}:return-to-draft`, { token: AGENCY_TOKEN })
    const response = await app.request('DELETE', `/payroll-ledgers/${regularId}`)

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'PAYROLL_LEDGER_HAS_ADDITIONAL' })
  })
})

describe('/payroll-ledgers 직접 운영', () => {
  it('승인 단계 없이 바로 마감합니다', async () => {
    const created = await app.request('POST', '/payroll-ledgers', {
      token: 'direct',
      body: { attributionMonth: '2026-04' },
    })
    expect(created.body).toMatchObject({
      workflow: 'DIRECT_CLOSE',
      allowedActions: ['SUBMIT', 'CLOSE', 'EDIT_ROWS', 'RECALCULATE', 'DELETE'],
    })

    const closed = await app.request('POST', `/payroll-ledgers/${created.body.id}:close`, { token: 'direct' })

    expect(closed.body).toMatchObject({ status: 'CLOSED' })
    expect(events.at(-1)).toMatchObject({
      type: 'payroll_pay_month.closed',
      companyId: DIRECT_COMPANY_ID,
      paymentMonth: '2026-04',
    })
  })
})

describe('/payroll-ledgers 원천세 신고 뒤', () => {
  const closedLedger: PayrollLedgerRecord = {
    id: 'pyl_01JBQ000000000000000000001' as Id<'payrollLedger'>,
    companyId: TEST_COMPANY_ID,
    kind: 'REGULAR',
    workflow: 'CLIENT_APPROVAL',
    status: 'CLOSED',
    title: '2026년 5월 급여',
    attributionMonth: '2026-05',
    paymentDate: '2026-05-25',
    wagePeriod: { start: '2026-05-01', end: '2026-05-31' },
    rows: [],
    rejection: null,
    reopenReason: null,
    calculatedAt: '2026-05-20T00:00:00.000Z',
    closedAt: '2026-05-21T00:00:00.000Z',
    version: 4,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  }
  /** 신고된 2026-05에 지급일이 있는 마감 전 추가 대장입니다. */
  const draftInFiledMonth: PayrollLedgerRecord = {
    ...closedLedger,
    id: 'pyl_01JBQ000000000000000000002' as Id<'payrollLedger'>,
    kind: 'ADDITIONAL',
    status: 'DRAFT',
    title: '2026년 5월 추가 급여',
    calculatedAt: null,
    closedAt: null,
    version: 1,
  }
  /** 신고되지 않은 2026-07에 지급일이 있는 마감 전 대장입니다. */
  const draftInOpenMonth: PayrollLedgerRecord = {
    ...draftInFiledMonth,
    id: 'pyl_01JBQ000000000000000000003' as Id<'payrollLedger'>,
    kind: 'REGULAR',
    title: '2026년 7월 급여',
    attributionMonth: '2026-07',
    paymentDate: '2026-07-25',
    wagePeriod: { start: '2026-07-01', end: '2026-07-31' },
  }
  const filedEvents: PayrollEvent[] = []
  const filedApp = payrollTestApp([
    PayrollLedgerRepository.layerMemory([closedLedger, draftInFiledMonth, draftInOpenMonth]),
    WithholdingFilingLock.layerMemory([{ companyId: TEST_COMPANY_ID, paymentMonth: '2026-05' }]),
    PayrollEventPublisher.layerMemory(filedEvents),
  ])

  afterAll(() => filedApp.dispose())

  it('다시 열기를 잠그고 금액이 바뀌는 동작을 숨깁니다', async () => {
    const detail = await filedApp.request('GET', `/payroll-ledgers/${closedLedger.id}`)
    expect(detail.body).toMatchObject({ withholdingFiled: true, allowedActions: [] })

    const response = await filedApp.request('POST', `/payroll-ledgers/${closedLedger.id}:reopen`, {
      body: { reason: '정정' },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: '2026-05' })
  })

  it('마감한 대장은 신고된 달에서 지급일을 옮길 수 없습니다', async () => {
    const response = await filedApp.request('PATCH', `/payroll-ledgers/${closedLedger.id}`, {
      body: { paymentDate: '2026-06-10' },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'PAYROLL_LEDGER_READ_ONLY', ledgerStatus: 'CLOSED' })
  })

  it('마감 전 대장이라도 신고된 달 안에서는 지급일을 바꿀 수 없습니다', async () => {
    const response = await filedApp.request('PATCH', `/payroll-ledgers/${draftInFiledMonth.id}`, {
      body: { paymentDate: '2026-05-31' },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: '2026-05' })
  })

  it('마감 전 대장은 신고된 달로 지급일을 옮길 수 없습니다', async () => {
    const response = await filedApp.request('PATCH', `/payroll-ledgers/${draftInOpenMonth.id}`, {
      body: { paymentDate: '2026-05-28' },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: '2026-05' })
  })

  it('마감 전 대장은 신고된 달에서 지급일을 옮겨 나갈 수 있고 남은 대장이 모두 마감이면 그 달 마감을 알립니다', async () => {
    const response = await filedApp.request('PATCH', `/payroll-ledgers/${draftInFiledMonth.id}`, {
      body: { paymentDate: '2026-06-10' },
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ paymentDate: '2026-06-10', paymentMonth: '2026-06', withholdingFiled: false })
    expect(filedEvents).toEqual([
      expect.objectContaining({
        type: 'payroll_pay_month.closed',
        paymentMonth: '2026-05',
        ledgerIds: [closedLedger.id],
      }),
    ])
  })
})
