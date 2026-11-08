import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { addEarner, payrollTestApp } from '../payroll-testing.ts'
import { rateBasedSetting, testEmployee } from '../payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory, type PayrollEmployee } from '../ports/payroll-employee-directory.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'

const employee: PayrollEmployee = { ...testEmployee(), departmentName: '경영지원' }
const app = payrollTestApp([
  PayrollEmployeeDirectory.layerMemory([{ companyId: TEST_COMPANY_ID, employee }]),
  PayrollSettingRepository.layerMemory([{ companyId: TEST_COMPANY_ID, setting: rateBasedSetting() }]),
])

afterAll(() => app.dispose())

let ledgerId = ''
let freelancerId = ''

beforeAll(async () => {
  const created = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2026-03' } })
  ledgerId = created.body.id
  freelancerId = await addEarner(app, {
    name: '박프리',
    identityType: 'RESIDENT',
    registrationNumber: '850505-1234567',
    email: 'free@example.com',
    departmentName: '디자인',
  })
})

describe('급여대장 행의 소득자 사본', () => {
  it('직원이 연결된 행은 HR의 이메일·가린 주민등록번호·부서를 복사해 둡니다', async () => {
    const rows = await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)

    expect(rows.body.items[0]).toMatchObject({
      employeeId: employee.id,
      earnerId: null,
      earner: { email: 'hana@example.com', registrationNumberMasked: '900101-1******', departmentName: '경영지원' },
    })
  })

  it('직원이 없는 행은 소득자 명부에서 이름과 가린 신원번호·이메일·부서를 복사합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { earnerId: freelancerId, input: { incomeType: 'BUSINESS', payAmount: 1_000_000 } },
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      employeeId: null,
      earnerId: freelancerId,
      payeeName: '박프리',
      earner: { email: 'free@example.com', registrationNumberMasked: '850505-1******', departmentName: '디자인' },
    })
    expect(JSON.stringify(response.body)).not.toContain('1234567')
  })

  it('명부에 이메일·부서가 없으면 사본도 비워 둡니다', async () => {
    const lecturerId = await addEarner(app, {
      name: '이강사',
      identityType: 'PASSPORT',
      registrationNumber: 'M12345678',
    })
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { earnerId: lecturerId, input: { incomeType: 'OTHER', payAmount: 500_000 } },
    })

    expect(response.status).toBe(201)
    expect(response.body.earner).toEqual({ email: null, registrationNumberMasked: '******678', departmentName: null })
  })

  it('근로 외 행에 직원을 이으면 HR 값을 복사합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { employeeId: employee.id, input: { incomeType: 'BUSINESS', payAmount: 100_000 } },
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ payeeName: employee.name, earnerId: null })
    expect(response.body.earner).toMatchObject({ email: 'hana@example.com', departmentName: '경영지원' })
  })

  it('직원과 소득자를 함께 주면 거절합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { employeeId: employee.id, earnerId: freelancerId, input: { incomeType: 'BUSINESS', payAmount: 1 } },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'PAYROLL_ROW_PAYEE_INVALID', reason: 'PAYEE_AMBIGUOUS' })
  })

  it('근로 행은 소득자 명부가 아니라 직원이어야 합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { earnerId: freelancerId, input: { incomeType: 'WAGE_MONTHLY', basePay: 2_000_000 } },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'PAYROLL_ROW_PAYEE_INVALID', reason: 'EMPLOYEE_REQUIRED' })
  })

  it('명부에 없는 소득자는 거절합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { earnerId: 'ern_01J00000000000000000000000', input: { incomeType: 'BUSINESS', payAmount: 1 } },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'PAYROLL_ROW_PAYEE_INVALID', reason: 'EARNER_NOT_FOUND' })
  })

  it('사본을 직접 입력하는 본문은 받지 않습니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: {
        payeeName: '정입력',
        earner: { email: 'typed@example.com' },
        input: { incomeType: 'BUSINESS', payAmount: 1 },
      },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'PAYROLL_ROW_PAYEE_INVALID', reason: 'PAYEE_REQUIRED' })
  })

  it('명부를 고쳐도 이미 만든 행은 그대로이고, 다시 계산하면 HR 값과 명부 값을 다시 복사합니다', async () => {
    const current = await app.request('GET', `/earners/${freelancerId}`)
    const updated = await app.request('PATCH', `/earners/${freelancerId}`, {
      ifMatch: current.headers.get('etag') ?? undefined,
      body: { name: '박프리랜서', email: 'free.new@example.com', departmentName: null },
    })
    const before = await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)
    employee.email = 'hana.new@example.com'
    employee.departmentName = '재무'

    const recalculated = await app.request('POST', `/payroll-ledgers/${ledgerId}:recalculate`)
    const rows = await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)

    expect(updated.status).toBe(200)
    const freelancerRow = (body: { items: { earnerId: string | null }[] }) =>
      body.items.find((row) => row.earnerId === freelancerId)
    expect(freelancerRow(before.body)).toMatchObject({ payeeName: '박프리', earner: { email: 'free@example.com' } })
    expect(recalculated.status).toBe(200)
    expect(rows.body.items[0].earner).toMatchObject({ email: 'hana.new@example.com', departmentName: '재무' })
    expect(freelancerRow(rows.body)).toMatchObject({
      payeeName: '박프리랜서',
      earner: { email: 'free.new@example.com', registrationNumberMasked: '850505-1******', departmentName: null },
    })
  })

  it('행을 고칠 때는 계산 입력만 바꾸고 소득자는 바꾸지 않습니다', async () => {
    const rows = await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)
    const row = rows.body.items.find((item: { earnerId: string | null }) => item.earnerId === freelancerId)
    const response = await app.request('PATCH', `/payroll-ledgers/${ledgerId}/rows/${row.id}`, {
      body: { input: { incomeType: 'BUSINESS', payAmount: 2_000_000 } },
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      earnerId: freelancerId,
      payeeName: '박프리랜서',
      input: { payAmount: 2_000_000 },
    })
  })

  it('대장 행이 가리키는 소득자는 명부에서 지울 수 없습니다', async () => {
    const response = await app.request('DELETE', `/earners/${freelancerId}`)

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'EARNER_IN_USE' })
  })
})
