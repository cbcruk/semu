import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS, makeHarness, PUBLIC_BASE_URL } from './legacy-client.ts'
import type { Harness, LegacyClient } from './legacy-client.ts'

const KIM = 'emp_01JBQ00000000000000000D3M1'
const FREELANCER = 'emp_01JBQ00000000000000000D3M2'
const EMPLOYEES = `/api/company/${DEMO_COMPANY_IDS.corporation}/employment/wage-employees`
const KIM_PATH = `${EMPLOYEES}/${KIM}`
const DEMO_WORK_CONTRACT = 'wct_01JBQ00000000000000000D3M1'
const DEMO_PAYROLL_CONTRACT = 'pct_01JBQ00000000000000000D3M1'

let harness: Harness
let client: LegacyClient

beforeEach(async () => {
  harness = makeHarness()
  client = harness.client()
  await client.login('owner@semu.example')
})

afterEach(() => harness.dispose())

/** 새 API로 근로소득자를 더 등록합니다. */
async function hire(name: string, registrationNumber: string): Promise<string> {
  const { token } = await harness.api.signIn('owner@semu.example')
  const response = await harness.api.request('POST', '/v1/employees', {
    token,
    body: { kind: 'WAGE', name, registrationNumber, joinDate: '2026-02-02' },
  })
  expect(response.status).toBe(201)
  return (await response.json()).id
}

describe('work contracts (근로 정보)', () => {
  it('lists the new work contracts in the DRF envelope and legacy row shape', async () => {
    const response = await client.request('GET', `${KIM_PATH}/work-contracts/`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      count: 1,
      next: null,
      previous: null,
      results: [
        expect.objectContaining({
          id: DEMO_WORK_CONTRACT,
          creation_method: 'manual',
          e_sign_request: null,
          contract_type: 'contract',
          start_date: '2025-03-02',
          end_date: '2027-03-01',
          status: expect.stringMatching(/^(active|expired)$/),
          work_type: 'regular',
          work_code: null,
          weekly_work_hours: 40,
          has_probation: false,
          probation_months: null,
          probation_pay_rate: null,
          document: null,
        }),
      ],
    })
  })

  it('creates a contract from the legacy body, newest first in the list and readable by ID', async () => {
    const created = await client.request('POST', `${KIM_PATH}/work-contracts/`, {
      body: {
        contract_type: 'regular',
        start_date: '2027-03-02',
        weekly_work_hours: 40,
        has_probation: true,
        probation_months: 3,
        probation_pay_rate: 90,
      },
    })
    const body = await created.json()
    const list = await (await client.request('GET', `${KIM_PATH}/work-contracts/?limit=1`)).json()
    const one = await client.request('GET', `${KIM_PATH}/work-contracts/${body.id}/`)

    expect(created.status).toBe(201)
    expect(body).toMatchObject({
      id: expect.stringMatching(/^wct_/),
      contract_type: 'regular',
      end_date: null,
      status: 'scheduled',
      has_probation: true,
      probation_months: 3,
      probation_pay_rate: 90,
    })
    expect(list.count).toBe(2)
    expect(list.results.map((row: { id: string }) => row.id)).toEqual([body.id])
    expect(list.next).toBe(`${PUBLIC_BASE_URL}${KIM_PATH}/work-contracts/?limit=1&offset=1`)
    expect(await one.json()).toEqual(body)
  })

  it('rejects fields the new API cannot store instead of dropping them', async () => {
    const response = await client.request('POST', `${KIM_PATH}/work-contracts/`, {
      body: { contract_type: 'regular', start_date: '2027-03-02', work_code: '415' },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      detail: 'Request validation failed.',
      code: 'VALIDATION_FAILED',
      errors: { work_code: ['Not supported by the new API yet.'] },
    })
  })

  it('maps the new rule violations back to the legacy field names', async () => {
    const response = await client.request('POST', `${KIM_PATH}/work-contracts/`, {
      body: { contract_type: 'contract', start_date: '2027-03-02', has_probation: true },
    })

    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({
      end_date: ['END_DATE_REQUIRED'],
      probation_months: ['PROBATION_MONTHS_REQUIRED'],
    })
  })

  it('answers an unknown contract, and edits the new API cannot make, with the legacy 404', async () => {
    const unknown = await client.request('GET', `${KIM_PATH}/work-contracts/wct_01JBQ00000000000000000ZZZ9/`)
    const edit = await client.request('PUT', `${KIM_PATH}/work-contracts/${DEMO_WORK_CONTRACT}/`, {
      body: { contract_type: 'regular', start_date: '2025-03-02' },
    })

    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ detail: 'Work contract not found.', code: 'NOT_FOUND' })
    expect(edit.status).toBe(404)
  })

  it('returns the indefinite conversion alert with lowercase enums', async () => {
    const response = await client.request('GET', `${KIM_PATH}/work-contracts/indefinite-conversion-alert/`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      is_target: expect.any(Boolean),
      status: expect.stringMatching(/^(none|approaching|exceeded)$/),
      is_exempt: false,
      exempt_reason: null,
      chain_start_date: '2025-03-02',
      chain_end_date: '2027-03-01',
      total_contract_days: 730,
      conversion_date: '2027-03-02',
    })
  })

  it('does not serve sub-resources of non-wage employees', async () => {
    const response = await client.request('GET', `${EMPLOYEES}/${FREELANCER}/work-contracts/`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ detail: 'Employee not found.', code: 'NOT_FOUND' })
  })
})

describe('payroll contracts (급여 정보)', () => {
  const PATH = `${KIM_PATH}/payroll-contracts`
  const monthly = {
    start_date: '2025-03-02',
    wage_type: 'monthly',
    amount: 3_400_000,
    monthly_work_hours: 209,
    pay_month: 'current',
    pay_day: 25,
    pay_method: 'transfer',
    bank_code: '004',
    account_number: '********6789',
    account_holder: '김세무',
  }

  it('lists the new payroll contracts with derived wages and a masked account number', async () => {
    const response = await client.request('GET', `${PATH}/`)

    expect((await response.json()).results).toEqual([
      expect.objectContaining({
        id: DEMO_PAYROLL_CONTRACT,
        wage_type: 'monthly',
        monthly_work_hours_source: 'manual',
        amount: 3_400_000,
        base_salary: 3_400_000,
        payment_items: [],
        fixed_overtime_enabled: false,
        fixed_overtime_amount: 0,
        has_bonus: false,
        pay_month: 'current',
        pay_day: 25,
        pay_method: 'transfer',
        bank_code: '004',
        account_number: '********6789',
        account_holder: '김세무',
        minimum_wage: { hourly: 10_320, contract_hourly: expect.any(Number), is_below: false },
      }),
    ])
  })

  it('returns one contract with its version ETag', async () => {
    const response = await client.request('GET', `${PATH}/${DEMO_PAYROLL_CONTRACT}/`)

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"1"')
  })

  it('keeps the stored account number when the masked one is sent back, like the legacy server', async () => {
    const response = await client.request('PUT', `${PATH}/${DEMO_PAYROLL_CONTRACT}/`, {
      body: { ...monthly, amount: 3_600_000 },
    })
    const { token } = await harness.api.signIn('owner@semu.example')
    const revealed = await harness.api.request('GET', `/v1/payroll-contracts/${DEMO_PAYROLL_CONTRACT}/account-number`, {
      token,
      headers: { 'x-access-reason': 'test' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"2"')
    expect(await response.json()).toMatchObject({ amount: 3_600_000, account_number: '********6789' })
    expect(await revealed.json()).toEqual({ accountNumber: '110123456789' })
  })

  it('passes a stale If-Match through as the legacy 412', async () => {
    const response = await client.request('PUT', `${PATH}/${DEMO_PAYROLL_CONTRACT}/`, {
      body: monthly,
      headers: { 'if-match': '"7"' },
    })

    expect(response.status).toBe(412)
    expect((await response.json()).code).toBe('VERSION_CONFLICT')
  })

  it('drops the account for direct payment', async () => {
    const response = await client.request('PUT', `${PATH}/${DEMO_PAYROLL_CONTRACT}/`, {
      body: { ...monthly, pay_method: 'direct', bank_code: null, account_number: null, account_holder: null },
    })

    expect(await response.json()).toMatchObject({
      pay_method: 'direct',
      bank_code: null,
      account_number: null,
      account_holder: null,
    })
  })

  it('creates a contract with fixed allowances computed by the new API', async () => {
    const response = await client.request('POST', `${PATH}/`, {
      body: {
        ...monthly,
        start_date: '2027-01-01',
        account_number: '110-987-654321',
        fixed_wage_auto_calc: true,
        fixed_overtime_enabled: true,
        fixed_overtime_hours: 10,
      },
    })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toMatchObject({
      fixed_overtime_enabled: true,
      fixed_overtime_hours: 10,
      account_number: '********4321',
    })
    expect(body.fixed_overtime_amount).toBeGreaterThan(0)
    expect(body.base_salary + body.fixed_overtime_amount).toBe(3_400_000)
  })

  it('rejects legacy integer payment item IDs and transfers without an account', async () => {
    const items = await client.request('POST', `${PATH}/`, {
      body: { ...monthly, payment_items: [{ payment_item: 3, is_enabled: true, amount: 100_000 }] },
    })
    const account = await client.request('POST', `${PATH}/`, { body: { ...monthly, account_number: undefined } })

    expect(items.status).toBe(422)
    expect((await items.json()).errors).toEqual({
      payment_items: ['Use payment item IDs from the new API (pit_…).'],
    })
    expect(account.status).toBe(422)
    expect((await account.json()).errors).toEqual({
      account_number: ['Bank transfers need a bank, account number and holder.'],
    })
  })

  it('deletes a contract', async () => {
    const removed = await client.request('DELETE', `${PATH}/${DEMO_PAYROLL_CONTRACT}/`)
    const after = await client.request('GET', `${PATH}/${DEMO_PAYROLL_CONTRACT}/`)

    expect(removed.status).toBe(204)
    expect(after.status).toBe(404)
    expect(await after.json()).toEqual({ detail: 'Payroll contract not found.', code: 'NOT_FOUND' })
  })

  it("does not show another employee's contract under this employee's path", async () => {
    const other = await hire('박하나', '900101-1234567')

    const response = await client.request('GET', `${EMPLOYEES}/${other}/payroll-contracts/${DEMO_PAYROLL_CONTRACT}/`)

    expect(response.status).toBe(404)
  })
})

describe('leaves of absence (휴직)', () => {
  const PATH = `${KIM_PATH}/leave-of-absences`
  // 오늘을 넉넉히 덮는 휴직입니다. 요약의 "지금 휴직 중"을 확인합니다.
  const illness = { reason: 'illness', start_date: '2026-01-05', end_date: '2031-12-31' }

  it('summarises no leaves with the employee version ETag', async () => {
    const response = await client.request('GET', `${KIM_PATH}/leave-of-absence-info/`)

    expect(response.headers.get('etag')).toBe('"1"')
    expect(await response.json()).toEqual({
      is_on_leave: false,
      current_leave: null,
      upcoming_leave: null,
      total_leave_days: 0,
      parental_leave_days: 0,
      parental_leave_remaining_days: 365,
    })
  })

  it('requires the employee version to register a leave, like the legacy server', async () => {
    const missing = await client.request('POST', `${PATH}/`, { body: illness })
    const stale = await client.request('POST', `${PATH}/`, { body: illness, headers: { 'if-match': '"9"' } })

    expect(missing.status).toBe(428)
    expect((await missing.json()).code).toBe('PRECONDITION_REQUIRED')
    expect(stale.status).toBe(412)
    expect((await stale.json()).code).toBe('VERSION_CONFLICT')
  })

  it('registers a leave that shows in the summary, the list and the employee status', async () => {
    const created = await client.request('POST', `${PATH}/`, {
      body: { ...illness, is_paid: true, paid_allowance: 500_000 },
      headers: { 'if-match': '"1"' },
    })
    const leave = await created.json()
    const info = await (await client.request('GET', `${KIM_PATH}/leave-of-absence-info/`)).json()
    const list = await (await client.request('GET', `${PATH}/`)).json()
    const employee = await (await client.request('GET', `${KIM_PATH}/`)).json()

    expect(created.status).toBe(201)
    expect(created.headers.get('etag')).toBe('"1"')
    expect(leave).toMatchObject({
      id: expect.stringMatching(/^lev_/),
      reason: 'illness',
      expected_return_date: '2032-01-01',
      actual_return_date: null,
      is_paid: true,
      paid_allowance: 500_000,
      include_in_service_years: false,
    })
    expect(info).toMatchObject({ is_on_leave: true, current_leave: leave })
    expect(list.results).toEqual([leave])
    expect(employee).toMatchObject({ status: 'LEAVE', status_code: 4 })
  })

  it('maps the paid allowance and overlap rules to the legacy errors', async () => {
    await client.request('POST', `${PATH}/`, { body: illness, headers: { 'if-match': '"1"' } })

    const unpaid = await client.request('POST', `${PATH}/`, {
      body: { ...illness, start_date: '2032-01-05', end_date: '2032-02-05', is_paid: true },
      headers: { 'if-match': '"1"' },
    })
    const overlap = await client.request('POST', `${PATH}/`, {
      body: { reason: 'etc', start_date: '2027-01-01', end_date: '2027-02-01' },
      headers: { 'if-match': '"1"' },
    })

    expect(unpaid.status).toBe(422)
    expect((await unpaid.json()).errors).toEqual({ paid_allowance: ['PAID_ALLOWANCE_REQUIRED'] })
    expect(overlap.status).toBe(400)
    expect(await overlap.json()).toMatchObject({ code: 'LEAVE_OVERLAP', overlapping_leave_id: expect.any(String) })
  })

  it('registers a finished leave with its return date in one legacy call', async () => {
    const response = await client.request('POST', `${PATH}/`, {
      body: { reason: 'etc', start_date: '2026-03-02', end_date: '2026-03-31', actual_return_date: '2026-03-20' },
      headers: { 'if-match': '"1"' },
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ reason: 'etc', actual_return_date: '2026-03-20' })
  })

  it('undoes the new leave when its return date is rejected', async () => {
    const response = await client.request('POST', `${PATH}/`, {
      body: { reason: 'etc', start_date: '2026-03-02', end_date: '2026-03-31', actual_return_date: '2026-05-01' },
      headers: { 'if-match': '"1"' },
    })
    const list = await (await client.request('GET', `${PATH}/`)).json()

    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ actual_return_date: ['RETURN_DATE_OUT_OF_RANGE'] })
    expect(list.count).toBe(0)
  })

  it('records a return with PUT and refuses other edits the new API cannot make', async () => {
    const leave = await (
      await client.request('POST', `${PATH}/`, { body: illness, headers: { 'if-match': '"1"' } })
    ).json()

    const edit = await client.request('PUT', `${PATH}/${leave.id}/`, {
      body: { ...illness, end_date: '2030-12-31' },
      headers: { 'if-match': '"1"' },
    })
    const returned = await client.request('PUT', `${PATH}/${leave.id}/`, {
      body: { ...illness, actual_return_date: '2026-02-02' },
      headers: { 'if-match': '"1"' },
    })

    expect(edit.status).toBe(422)
    expect(Object.keys((await edit.json()).errors)).toEqual(['non_field_errors'])
    expect(returned.status).toBe(200)
    expect(await returned.json()).toMatchObject({ id: leave.id, actual_return_date: '2026-02-02' })
  })

  it('deletes a leave', async () => {
    const leave = await (
      await client.request('POST', `${PATH}/`, { body: illness, headers: { 'if-match': '"1"' } })
    ).json()

    const removed = await client.request('DELETE', `${PATH}/${leave.id}/`, { headers: { 'if-match': '"1"' } })
    const after = await client.request('GET', `${PATH}/${leave.id}/`)

    expect(removed.status).toBe(204)
    expect(after.status).toBe(404)
    expect(await after.json()).toEqual({ detail: 'Leave of absence not found.', code: 'NOT_FOUND' })
  })
})

describe('retirement (퇴직)', () => {
  const PATH = `${KIM_PATH}/retirement-info/`
  const resignation = { leave_date: '2026-10-31', leaving_reason: '11', leaving_detail_reason: '11-1' }

  it('returns the legacy defaults before a retirement', async () => {
    const response = await client.request('GET', PATH)

    expect(response.headers.get('etag')).toBe('"1"')
    expect(await response.json()).toEqual({
      retirement_benefit_type: 'grant',
      has_interim_settlement: false,
      interim_settlement_date: null,
      interim_settlement_reason: null,
      leave_date: null,
      leaving_reason: null,
      leaving_detail_reason: null,
      severance_amount: null,
      severance_settlement_status: null,
      updated: null,
    })
  })

  it('registers a retirement with :resign, needing the employee version', async () => {
    const missing = await client.request('PUT', PATH, { body: resignation })
    const saved = await client.request('PUT', PATH, { body: resignation, headers: { 'if-match': '"1"' } })
    const employee = await (await client.request('GET', `${KIM_PATH}/`)).json()

    expect(missing.status).toBe(428)
    expect(saved.status).toBe(200)
    expect(saved.headers.get('etag')).toBe('"2"')
    expect(await saved.json()).toMatchObject({
      leave_date: '2026-10-31',
      leaving_reason: '11',
      leaving_detail_reason: '11-1',
      updated: expect.any(String),
    })
    expect(employee).toMatchObject({ status: 'RESIGNED', leave_date: '2026-10-31' })
  })

  it('changes only the reason without If-Match, like the legacy server', async () => {
    await client.request('PUT', PATH, { body: resignation, headers: { 'if-match': '"1"' } })

    const response = await client.request('PUT', PATH, {
      body: { ...resignation, leaving_reason: '12', leaving_detail_reason: '12-1' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ leaving_reason: '12', leaving_detail_reason: '12-1' })
  })

  it('rejects benefit settings the new API cannot store and maps resignation rules to fields', async () => {
    const pension = await client.request('PUT', PATH, {
      body: { ...resignation, retirement_benefit_type: 'pension_dc' },
      headers: { 'if-match': '"1"' },
    })
    const beforeJoin = await client.request('PUT', PATH, {
      body: { ...resignation, leave_date: '2020-01-01' },
      headers: { 'if-match': '"1"' },
    })

    expect(pension.status).toBe(422)
    expect((await pension.json()).errors).toEqual({ retirement_benefit_type: ['Not supported by the new API yet.'] })
    expect(beforeJoin.status).toBe(422)
    expect((await beforeJoin.json()).errors).toEqual({ leave_date: ['The leave date cannot be before the join date.'] })
  })

  it('cancels the retirement with DELETE', async () => {
    await client.request('PUT', PATH, { body: resignation, headers: { 'if-match': '"1"' } })

    const stale = await client.request('DELETE', PATH, { headers: { 'if-match': '"1"' } })
    const removed = await client.request('DELETE', PATH, { headers: { 'if-match': '"2"' } })
    const after = await (await client.request('GET', PATH)).json()

    expect(stale.status).toBe(412)
    expect(removed.status).toBe(204)
    expect(removed.headers.get('etag')).toBe('"3"')
    expect(after.leave_date).toBeNull()
  })
})
