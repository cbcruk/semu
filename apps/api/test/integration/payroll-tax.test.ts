import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../src/modules/identity-access/identity-access.public.ts'
import { makeTestApp } from '../../src/modules/identity-access/testing-http.ts'

const app = makeTestApp()
const WITHHOLDING_2026_10 = 'fil_01JBQ0000000000000000000D1'
const RETURN_FILE = 'fle_01JBQ0000000000000000000R1'
/** HR 데모 시드의 근로소득자입니다. 데모 급여계약(월 340만 원)과 공제 설정(가족 3명)이 있습니다. */
const DEMO_WAGE_EMPLOYEE = 'emp_01JBQ00000000000000000D3M1'

let owner = ''
let agent = ''
let employeeId = ''
let ledgerId = ''

beforeAll(async () => {
  owner = (await app.signIn('owner@semu.example')).token
  agent = (await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.corporation })).token
})

afterAll(() => app.dispose())

async function payrollRequirement(): Promise<string> {
  const filing = await (await app.request('GET', `/v1/filings/${WITHHOLDING_2026_10}`, { token: owner })).json()
  return filing.requirements.find((requirement: { code: string }) => requirement.code === 'PAYROLL_LEDGER_CLOSED')
    .response
}

describe('HR → Payroll 연결', () => {
  it('HR에 등록한 직원으로 급여 행을 만듭니다', async () => {
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

    const contracted = await app.request('POST', '/v1/employees', {
      token: owner,
      body: { kind: 'WAGE', name: '최계약', joinDate: '2026-01-05' },
    })
    const contractedId = (await contracted.json()).id
    const payrollContract = await app.request('POST', `/v1/employees/${contractedId}/payroll-contracts`, {
      token: owner,
      body: { startDate: '2026-01-05', wageType: 'MONTHLY', amount: 2_800_000, monthlyWorkHours: 209 },
    })
    expect(payrollContract.status).toBe(201)
    const withholding = await app.request('PUT', `/v1/employees/${contractedId}/tax-withholding`, {
      token: owner,
      body: {
        effectiveFrom: '2026-01-05',
        dependantsCount: 2,
        childrenAged8To20Count: 1,
        childcareChildrenCount: 2,
        calcMethod: 'MANUAL',
        manualIncomeTax: 40_000,
        adjustmentRatePpm: 1_200_000,
      },
    })
    expect(withholding.status).toBe(200)

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
      // 급여계약이 없어 기본값(PAYROLL_DEFAULTS_WITHOUT_HR)을 씁니다.
      input: { basePay: 3_000_000 },
      snapshot: { monthlyStandardHours: 104, dailyRestMinutes: 240 },
    })

    const contractedRow = rows.items.find((item: { employeeId: string }) => item.employeeId === contractedId)
    expect(contractedRow).toMatchObject({
      payeeName: '최계약',
      incomeType: 'WAGE_MONTHLY',
      input: { basePay: 2_800_000 },
      snapshot: {
        dependants: 2,
        childrenAged8To20: 1,
        childcareChildren: 2,
        childcareChildrenEffectiveFrom: '2026-01-05',
        withholdingRatePpm: 1_200_000,
        manualIncomeTax: 40_000,
      },
    })
    expect(row.snapshot).not.toHaveProperty('childcareChildren')

    // 보육수당 한도는 자녀 1명당 20만원이라 HR의 6세 이하 자녀 2명이면 월 40만원까지 비과세입니다.
    const childcare = await app.request('PATCH', `/v1/payroll-ledgers/${ledgerId}/rows/${contractedRow.id}`, {
      token: owner,
      ifMatch: `"${ledger.version}"`,
      body: {
        input: {
          incomeType: 'WAGE_MONTHLY',
          basePay: 2_800_000,
          paymentItems: [
            { code: 'CHILDCARE', name: '보육수당', amount: 300_000, nonTaxableCategory: 'CHILDCARE' },
            { code: 'CHILDCARE_2', name: '가족수당(보육)', amount: 200_000, nonTaxableCategory: 'CHILDCARE' },
          ],
        },
      },
    })
    expect(childcare.status).toBe(200)
    const childcareRow = await childcare.json()
    expect(
      childcareRow.result.payments.filter((line: { code: string }) => line.code.startsWith('CHILDCARE')),
    ).toMatchObject([
      { nonTaxableAmount: 300_000, taxableAmount: 0 },
      { nonTaxableAmount: 100_000, taxableAmount: 100_000 },
    ])
    expect(childcareRow.result).toMatchObject({ nonTaxablePay: 400_000 })

    const demoRow = rows.items.find((item: { employeeId: string }) => item.employeeId === DEMO_WAGE_EMPLOYEE)
    expect(demoRow).toMatchObject({
      input: { basePay: 3_400_000 },
      snapshot: { dependants: 3, childrenAged8To20: 1 },
    })
  })
})

describe('Payroll → Tax 연결', () => {
  it('지급월의 급여대장이 모두 마감되면 원천세 신고 건의 제출 자료 항목인 급여대장 마감을 제출됨으로 표시합니다', async () => {
    expect(await payrollRequirement()).toBe('PENDING')

    const closed = await app.request('POST', `/v1/payroll-ledgers/${ledgerId}:close`, { token: owner })

    expect(closed.status).toBe(200)
    expect((await closed.json()).status).toBe('CLOSED')
    expect(await payrollRequirement()).toBe('PROVIDED')
  })

  it('급여대장을 다시 열면 그 제출 자료 항목을 대기로 되돌립니다', async () => {
    const reopened = await app.request('POST', `/v1/payroll-ledgers/${ledgerId}:reopen`, {
      token: owner,
      body: { reason: '상여 누락' },
    })

    expect(reopened.status).toBe(200)
    expect(await payrollRequirement()).toBe('PENDING')

    await app.request('POST', `/v1/payroll-ledgers/${ledgerId}:close`, { token: owner })
    expect(await payrollRequirement()).toBe('PROVIDED')
  })

  it('원천세 신고 건은 마감된 급여대장의 원천세 합계를 신고서 A01 줄로 묻습니다', async () => {
    const rows = await (await app.request('GET', `/v1/payroll-ledgers/${ledgerId}/rows`, { token: owner })).json()
    const wageRows = rows.items.filter(
      (row: { incomeType: string; result: unknown }) => row.incomeType.startsWith('WAGE_') && row.result !== null,
    )
    const sum = (key: string) =>
      wageRows.reduce((total: number, row: { result: Record<string, number> }) => total + row.result[key]!, 0)

    const response = await app.request('GET', `/v1/filings/${WITHHOLDING_2026_10}/withholding-lines`, { token: owner })

    expect(response.status).toBe(200)
    const [october] = (await response.json()).items
    expect(october).toMatchObject({ paymentMonth: '2026-10', ledgerCount: 1, closedCount: 1 })
    expect(october.lines).toEqual([
      {
        lineCode: 'A01',
        subtotalCode: 'A10',
        incomeKind: 'WAGE',
        headcount: wageRows.length,
        grossPay: sum('grossPay'),
        taxablePay: sum('taxablePay'),
        incomeTax: sum('incomeTax'),
        localIncomeTax: sum('localIncomeTax'),
      },
    ])
  })
})

describe('Tax → Payroll 연결', () => {
  it('원천세를 신고한 뒤에는 금액을 바꾸는 급여대장 커맨드를 거부합니다(409)', async () => {
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

describe('Payroll → Bookkeeping 연결', () => {
  it('Payroll의 인건비를 Bookkeeping 보고서에 보여 줍니다', async () => {
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
