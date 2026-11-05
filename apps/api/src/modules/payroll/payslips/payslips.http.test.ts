import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { payrollTestApp } from '../payroll-testing.ts'
import { rateBasedSetting, testEmployee } from '../payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'

const app = payrollTestApp([
  PayrollEmployeeDirectory.layerMemory([{ companyId: TEST_COMPANY_ID, employee: testEmployee() }]),
  PayrollSettingRepository.layerMemory([{ companyId: TEST_COMPANY_ID, setting: rateBasedSetting() }]),
])

afterAll(() => app.dispose())

let ledgerId = ''

beforeAll(async () => {
  const created = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2026-03' } })
  ledgerId = created.body.id
  await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
    body: { payeeName: '박프리', input: { incomeType: 'BUSINESS', payAmount: 1_000_000 } },
  })
})

describe('/payslips', () => {
  it('shows nothing until the ledger is closed', async () => {
    const response = await app.request('GET', `/payslips?ledgerId=${ledgerId}`)

    expect(response.body.items).toEqual([])
  })

  it('lists one payslip per row of a closed ledger', async () => {
    await app.request('POST', `/payroll-ledgers/${ledgerId}:close`)
    const response = await app.request('GET', '/payslips?paymentMonth=2026-03')

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(2)
    expect(response.body.items[1]).toMatchObject({
      payeeName: '박프리',
      incomeType: 'BUSINESS',
      grossPay: 1_000_000,
      netPay: 967_000,
      delivery: { status: 'NOT_SENT', attempts: 0 },
    })
  })

  it('requires an Idempotency-Key to send', async () => {
    const list = await app.request('GET', `/payslips?ledgerId=${ledgerId}`)
    const response = await app.request('POST', '/payslips:send', {
      body: { payslipIds: list.body.items.map((item: { id: string }) => item.id) },
    })

    expect(response.status).toBe(428)
    expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' })
  })

  it('sends by email and fails payees without an address', async () => {
    const list = await app.request('GET', `/payslips?ledgerId=${ledgerId}`)
    const ids = list.body.items.map((item: { id: string }) => item.id)
    const first = await app.request('POST', '/payslips:send', {
      headers: { 'idempotency-key': 'send-1' },
      body: { payslipIds: ids },
    })

    expect(first.status).toBe(202)
    expect(first.body).toMatchObject({
      status: 'PARTIALLY_SUCCEEDED',
      result: {
        items: [
          { payslipId: ids[0], status: 'SENT', failureReason: null },
          { payslipId: ids[1], status: 'FAILED', failureReason: 'NO_EMAIL' },
        ],
      },
    })

    const replay = await app.request('POST', '/payslips:send', {
      headers: { 'idempotency-key': 'send-1' },
      body: { payslipIds: ids },
    })
    expect(replay.body.id).toBe(first.body.id)

    const detail = await app.request('GET', `/payslips/${ids[0]}`)
    expect(detail.body.delivery).toMatchObject({ status: 'SENT', attempts: 1 })
  })

  it('keeps the ledger closed after sending', async () => {
    const response = await app.request('GET', `/payroll-ledgers/${ledgerId}`)

    expect(response.body.status).toBe('CLOSED')
  })
})
