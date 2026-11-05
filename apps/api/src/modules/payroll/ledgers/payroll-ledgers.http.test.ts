import { afterAll, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { AGENCY_TOKEN, payrollTestApp } from '../payroll-testing.ts'
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
  incomeTax: { dependants: 1, childrenAged8To20: 0, withholdingRatePpm: 1_000_000, manualAmount: null },
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

const app = payrollTestApp(
  [
    PayrollEmployeeDirectory.layerMemory([
      { companyId: TEST_COMPANY_ID, employee },
      { companyId: DIRECT_COMPANY_ID, employee },
    ]),
    PayrollSettingRepository.layerMemory([
      { companyId: TEST_COMPANY_ID, setting: { ...rateMethods, workflow: 'CLIENT_APPROVAL' } },
      { companyId: DIRECT_COMPANY_ID, setting: rateMethods },
    ]),
    PayrollEventPublisher.layerMemory(events),
  ],
  [
    ['direct', testActor({ companyId: DIRECT_COMPANY_ID })],
    ['viewer', testActor({ permissions: new Set(['payroll-ledger:read']) })],
  ],
)

afterAll(() => app.dispose())

describe('/payroll-ledgers with client approval', () => {
  let ledgerId = ''
  let rowId = ''

  it('creates the regular ledger with wage rows from HR', async () => {
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

  it('recalculates a row with the legacy-verified amounts', async () => {
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

  it('refuses a second wage row for the same employee and month', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { employeeId: EMPLOYEE_ID, input: { incomeType: 'WAGE_MONTHLY', basePay: 100_000 } },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'WAGE_INCOME_DUPLICATED', ledgerId })
  })

  it('refuses a stale If-Match', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}:submit`, {
      headers: { 'if-match': '"1"' },
    })

    expect(response.status).toBe(412)
    expect(response.body).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 2 })
  })

  it('moves through submit, approval request, rejection and approval', async () => {
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

  it('publishes the pay-month closed event with the withholding summary', () => {
    expect(events.at(-1)).toMatchObject({
      type: 'payroll_pay_month.closed',
      companyId: TEST_COMPANY_ID,
      paymentMonth: '2026-03',
      ledgerIds: [ledgerId],
      withholding: [
        {
          incomeKind: 'WAGE',
          headcount: 1,
          grossPay: 3_200_000,
          taxablePay: 3_000_000,
          incomeTax: 60_380,
          localIncomeTax: 6_030,
        },
      ],
    })
  })

  it('keeps the closed ledger read-only', async () => {
    const response = await app.request('DELETE', `/payroll-ledgers/${ledgerId}/rows/${rowId}`)

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'PAYROLL_LEDGER_READ_ONLY', ledgerStatus: 'CLOSED' })
  })

  it('reopens the pay month when the ledger is reopened', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}:reopen`, { body: { reason: '상여 누락' } })

    expect(response.body).toMatchObject({ status: 'SUBMITTED', reopenReason: '상여 누락', closedAt: null })
    expect(events.at(-1)).toMatchObject({ type: 'payroll_pay_month.reopened', paymentMonth: '2026-03' })
  })

  it('lists ledgers by attribution month', async () => {
    const response = await app.request('GET', '/payroll-ledgers?attributionMonth=2026-03')

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
  })

  it('needs the update permission to change rows', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}:recalculate`, { token: 'viewer' })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'payroll-ledger:update' })
  })
})

describe('/payroll-ledgers additional ledgers', () => {
  let regularId = ''
  let additionalId = ''

  it('blocks an additional ledger until the regular one is submitted', async () => {
    const regular = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2027-03' } })
    regularId = regular.body.id

    const blocked = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2027-03' } })

    expect(blocked.status).toBe(409)
    expect(blocked.body).toMatchObject({ code: 'ADDITIONAL_LEDGER_BLOCKED', reason: 'REGULAR_LEDGER_NOT_SUBMITTED' })
  })

  it('creates an additional ledger that takes business income but no wage income', async () => {
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

  it('needs a payee name for non-wage rows', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${additionalId}/rows`, {
      body: { input: { incomeType: 'OTHER', payAmount: 500_000 } },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'PAYROLL_ROW_PAYEE_INVALID', reason: 'PAYEE_NAME_REQUIRED' })
  })

  it('keeps the regular ledger while additional ledgers exist', async () => {
    await app.request('POST', `/payroll-ledgers/${regularId}:return-to-draft`, { token: AGENCY_TOKEN })
    const response = await app.request('DELETE', `/payroll-ledgers/${regularId}`)

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'PAYROLL_LEDGER_HAS_ADDITIONAL' })
  })
})

describe('/payroll-ledgers self-service', () => {
  it('closes directly without an approval step', async () => {
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

describe('/payroll-ledgers after withholding is filed', () => {
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
  const filedApp = payrollTestApp([
    PayrollLedgerRepository.layerMemory([closedLedger]),
    WithholdingFilingLock.layerMemory([{ companyId: TEST_COMPANY_ID, paymentMonth: '2026-05' }]),
  ])

  afterAll(() => filedApp.dispose())

  it('locks reopening and hides amount-changing actions', async () => {
    const detail = await filedApp.request('GET', `/payroll-ledgers/${closedLedger.id}`)
    expect(detail.body).toMatchObject({ withholdingFiled: true, allowedActions: [] })

    const response = await filedApp.request('POST', `/payroll-ledgers/${closedLedger.id}:reopen`, {
      body: { reason: '정정' },
    })

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: '2026-05' })
  })
})
