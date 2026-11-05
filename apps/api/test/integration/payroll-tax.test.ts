import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../src/modules/identity-access/identity-access.public.ts'
import { makeTestApp } from '../../src/modules/identity-access/testing-http.ts'

const app = makeTestApp()
const WITHHOLDING_2026_10 = 'fil_01JBQ0000000000000000000D1'
const RETURN_FILE = 'fle_01JBQ0000000000000000000R1'

let owner = ''
let agent = ''
let employeeId = ''
let ledgerId = ''

beforeAll(async () => {
  owner = (await app.signIn('owner@alfred.example')).token
  agent = (await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.corporation })).token
})

afterAll(() => app.dispose())

async function payrollRequirement(): Promise<string> {
  const filing = await (await app.request('GET', `/v1/filings/${WITHHOLDING_2026_10}`, { token: owner })).json()
  return filing.requirements.find((requirement: { code: string }) => requirement.code === 'PAYROLL_LEDGER_CLOSED')
    .response
}

describe('HR → Payroll', () => {
  it('builds wage rows from employees registered in HR', async () => {
    const hired = await app.request('POST', '/v1/employees', {
      token: owner,
      body: { kind: 'WAGE', name: '박급여', joinDate: '2026-01-05', email: 'pay@example.com' },
    })
    expect(hired.status).toBe(201)
    employeeId = (await hired.json()).id
    const contract = await app.request('POST', `/v1/employees/${employeeId}/work-contracts`, {
      token: owner,
      body: { contractType: 'PERMANENT', startDate: '2026-01-05', weeklyWorkHours: 20 },
    })
    expect(contract.status).toBe(201)

    const created = await app.request('POST', '/v1/payroll-ledgers', {
      token: owner,
      body: { attributionMonth: '2026-10' },
    })
    expect(created.status).toBe(201)
    const ledger = await created.json()
    ledgerId = ledger.id
    expect(ledger).toMatchObject({ status: 'DRAFT', paymentDate: '2026-10-25' })

    const rows = await (await app.request('GET', `/v1/payroll-ledgers/${ledgerId}/rows`, { token: owner })).json()
    expect(rows.items).toHaveLength(ledger.rowCount)
    const row = rows.items.find((item: { employeeId: string }) => item.employeeId === employeeId)
    expect(row).toMatchObject({ employeeId, incomeType: 'WAGE_MONTHLY' })
    expect(row).toMatchObject({
      payeeName: '박급여',
      input: { basePay: 3_000_000 },
      snapshot: { monthlyStandardHours: 104, dailyRestMinutes: 240 },
    })
  })
})

describe('Payroll → Tax', () => {
  it('marks the withholding payroll requirement provided once every ledger of the pay month is closed', async () => {
    expect(await payrollRequirement()).toBe('PENDING')

    const closed = await app.request('POST', `/v1/payroll-ledgers/${ledgerId}:close`, { token: owner })

    expect(closed.status).toBe(200)
    expect((await closed.json()).status).toBe('CLOSED')
    expect(await payrollRequirement()).toBe('PROVIDED')
  })

  it('puts the requirement back to pending when the ledger is reopened', async () => {
    const reopened = await app.request('POST', `/v1/payroll-ledgers/${ledgerId}:reopen`, {
      token: owner,
      body: { reason: '상여 누락' },
    })

    expect(reopened.status).toBe(200)
    expect(await payrollRequirement()).toBe('PENDING')

    await app.request('POST', `/v1/payroll-ledgers/${ledgerId}:close`, { token: owner })
    expect(await payrollRequirement()).toBe('PROVIDED')
  })
})

describe('Tax → Payroll', () => {
  it('refuses amount-changing ledger commands after the withholding filing is filed', async () => {
    for (const command of ['start-review', 'start-preparing']) {
      const response = await app.request('POST', `/v1/filings/${WITHHOLDING_2026_10}:${command}`, { token: agent })
      expect(response.status).toBe(200)
    }
    const filed = await app.request('POST', `/v1/filings/${WITHHOLDING_2026_10}:file`, {
      token: agent,
      body: { payableAmount: 120_000, returnFileId: RETURN_FILE },
    })
    expect(filed.status).toBe(200)
    expect((await filed.json()).status).toBe('FILED')

    const detail = await (await app.request('GET', `/v1/payroll-ledgers/${ledgerId}`, { token: owner })).json()
    const reopen = await app.request('POST', `/v1/payroll-ledgers/${ledgerId}:reopen`, {
      token: owner,
      body: { reason: '정정' },
    })

    expect(detail).toMatchObject({ withholdingFiled: true, allowedActions: [] })
    expect(reopen.status).toBe(409)
    expect(await reopen.json()).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: '2026-10' })
  })
})

describe('Payroll → Bookkeeping', () => {
  it('shows the payroll labor cost in the bookkeeping report', async () => {
    const payroll = await (await app.request('GET', '/v1/labor-cost-reports/2026', { token: owner })).json()
    const bookkeeping = await (await app.request('GET', '/v1/reports/labor-cost?year=2026', { token: owner })).json()
    const payrollOctober = payroll.months.find((month: { month: string }) => month.month === '2026-10')
    const bookkeepingOctober = bookkeeping.months.find((month: { month: string }) => month.month === '2026-10')

    expect(payrollOctober.amounts.wage).toBeGreaterThan(0)
    expect(bookkeepingOctober).toEqual({
      month: '2026-10',
      amounts: {
        wageAmount: payrollOctober.amounts.wage,
        dailyWageAmount: payrollOctober.amounts.daily,
        businessIncomeAmount: payrollOctober.amounts.business,
        otherIncomeAmount: payrollOctober.amounts.other,
      },
      paidHeadcount: {
        wageAmount: payrollOctober.headcount.wage,
        dailyWageAmount: payrollOctober.headcount.daily,
        businessIncomeAmount: payrollOctober.headcount.business,
        otherIncomeAmount: payrollOctober.headcount.other,
      },
      employedCount: payrollOctober.employment.employed,
      joinedCount: payrollOctober.employment.joined,
      leftCount: payrollOctober.employment.left,
    })
  })
})
