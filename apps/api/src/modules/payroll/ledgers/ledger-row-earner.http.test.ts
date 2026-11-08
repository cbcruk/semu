import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { payrollTestApp } from '../payroll-testing.ts'
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

beforeAll(async () => {
  const created = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2026-03' } })
  ledgerId = created.body.id
})

describe('급여대장 행의 소득자 사본', () => {
  it('직원이 연결된 행은 HR의 이메일·가린 주민등록번호·부서를 복사해 둡니다', async () => {
    const rows = await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)

    expect(rows.body.items[0]).toMatchObject({
      employeeId: employee.id,
      earner: { email: 'hana@example.com', registrationNumberMasked: '900101-1******', departmentName: '경영지원' },
    })
  })

  it('직원이 없는 행은 소득자 사본을 입력받습니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: {
        payeeName: '박프리',
        earner: { email: 'free@example.com', registrationNumberMasked: '850505-1******', departmentName: '디자인' },
        input: { incomeType: 'BUSINESS', payAmount: 1_000_000 },
      },
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      employeeId: null,
      earner: { email: 'free@example.com', registrationNumberMasked: '850505-1******', departmentName: '디자인' },
    })
  })

  it('입력하지 않은 사본 값은 비워 둡니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { payeeName: '이강사', input: { incomeType: 'OTHER', payAmount: 500_000 } },
    })

    expect(response.status).toBe(201)
    expect(response.body.earner).toEqual({ email: null, registrationNumberMasked: null, departmentName: null })
  })

  it('직원이 없는 행의 사본은 고칠 때 통째로 바꿉니다', async () => {
    const added = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: {
        payeeName: '최일용',
        earner: { email: 'old@example.com', departmentName: '물류' },
        input: { incomeType: 'DAILY', payAmount: 150_000, workDays: 1 },
      },
    })
    const response = await app.request('PATCH', `/payroll-ledgers/${ledgerId}/rows/${added.body.id}`, {
      body: { earner: { email: 'new@example.com' } },
    })

    expect(response.status).toBe(200)
    expect(response.body.earner).toEqual({
      email: 'new@example.com',
      registrationNumberMasked: null,
      departmentName: null,
    })
  })

  it('직원이 연결된 행에는 사본을 입력할 수 없습니다', async () => {
    const added = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: {
        employeeId: employee.id,
        payeeName: '김하나',
        earner: { email: 'other@example.com' },
        input: { incomeType: 'BUSINESS', payAmount: 100_000 },
      },
    })
    const rows = await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)
    const patched = await app.request('PATCH', `/payroll-ledgers/${ledgerId}/rows/${rows.body.items[0].id}`, {
      body: { earner: { email: 'other@example.com' } },
    })

    expect(added.status).toBe(422)
    expect(added.body).toMatchObject({ code: 'PAYROLL_ROW_PAYEE_INVALID', reason: 'EARNER_FROM_EMPLOYEE' })
    expect(patched.status).toBe(422)
    expect(patched.body).toMatchObject({ code: 'PAYROLL_ROW_PAYEE_INVALID', reason: 'EARNER_FROM_EMPLOYEE' })
  })

  it('이름과 함께 직원을 이은 근로 외 행도 HR 값을 복사합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { employeeId: employee.id, payeeName: '김하나', input: { incomeType: 'BUSINESS', payAmount: 100_000 } },
    })

    expect(response.status).toBe(201)
    expect(response.body.earner).toMatchObject({ email: 'hana@example.com', departmentName: '경영지원' })
  })

  it('다시 계산하면 HR 값을 다시 복사합니다', async () => {
    employee.email = 'hana.new@example.com'
    employee.departmentName = '재무'

    const recalculated = await app.request('POST', `/payroll-ledgers/${ledgerId}:recalculate`)
    const rows = await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)

    expect(recalculated.status).toBe(200)
    expect(rows.body.items[0].earner).toMatchObject({ email: 'hana.new@example.com', departmentName: '재무' })
    expect(rows.body.items.find((row: { payeeName: string }) => row.payeeName === '박프리').earner).toMatchObject({
      email: 'free@example.com',
    })
  })

  it('주민등록번호는 가린 형식만 받고 원문은 거절합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: {
        payeeName: '정원문',
        earner: { registrationNumberMasked: '900101-1234567' },
        input: { incomeType: 'BUSINESS', payAmount: 100_000 },
      },
    })

    expect(response.status).toBe(400)
  })

  it('이메일 형식이 아니면 거절합니다', async () => {
    const response = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
      body: { payeeName: '정메일', earner: { email: 'not-an-email' }, input: { incomeType: 'BUSINESS', payAmount: 1 } },
    })

    expect(response.status).toBe(400)
  })
})
