import { afterAll, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { addPaymentItem, clockAt, payrollTestApp } from '../payroll-testing.ts'
import { PayrollEmployeeDirectory, type PayrollEmployee } from '../ports/payroll-employee-directory.ts'
import { defaultPayrollSetting } from '../settings/payroll-setting.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'

const OTHER_COMPANY_ID = 'cmp_01JBQ000000000000000000009' as Id<'company'>

const employee: PayrollEmployee = {
  id: 'emp_01JBQ000000000000000000009' as Id<'employee'>,
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

const app = payrollTestApp(
  [
    PayrollEmployeeDirectory.layerMemory([{ companyId: TEST_COMPANY_ID, employee }]),
    PayrollSettingRepository.layerMemory([
      {
        companyId: TEST_COMPANY_ID,
        setting: {
          ...defaultPayrollSetting(),
          deductionMethods: {
            nationalPension: 'RATE',
            healthInsurance: 'RATE',
            employmentInsurance: 'RATE',
            incomeTax: 'TAX_TABLE',
          },
        },
      },
    ]),
    clockAt('2026-11-07T00:00:00+09:00'),
  ],
  [
    ['other-company', testActor({ companyId: OTHER_COMPANY_ID })],
    ['taxation-only', testActor({ companyId: OTHER_COMPANY_ID, plans: new Set(['TAXATION']) })],
    ['no-plan', testActor({ plans: new Set() })],
    ['reader', testActor({ permissions: new Set(['payment-item:read']) })],
  ],
)

afterAll(() => app.dispose())

type Line = { code: string; name: string; amount: number; taxableAmount?: number; nonTaxableAmount?: number }

describe('지급 항목 카탈로그', () => {
  let mealId = ''

  it('표준 항목 목록은 비과세 유형과 속성 기본값을 함께 줍니다', async () => {
    const response = await app.request('GET', '/payroll-payment-categories')

    expect(response.status).toBe(200)
    expect(response.body.items).toContainEqual(
      expect.objectContaining({ code: 'MEAL', name: '식대', nonTaxableCategory: 'MEAL', includeInOrdinaryWage: true }),
    )
    expect(response.body.items).toContainEqual(
      expect.objectContaining({ code: 'ANNUAL_LEAVE_PAY', nonTaxableCategory: null, includeInMinimumWage: false }),
    )
  })

  it('표준 항목을 불러와 지급 항목을 만듭니다', async () => {
    const response = await app.request('POST', '/payroll-payment-items', {
      body: { categoryCode: 'MEAL', defaultAmount: 250_000 },
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(response.body).toEqual({
      id: expect.stringMatching(/^pit_/),
      categoryCode: 'MEAL',
      name: '식대',
      nonTaxableCategory: 'MEAL',
      companyNonTaxableLimit: null,
      defaultAmount: 250_000,
      includeInOrdinaryWage: true,
      includeInMinimumWage: true,
      prorate: false,
      archivedAt: null,
      version: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    mealId = response.body.id
  })

  it('비과세 항목은 직접 만들 수 없고 같은 이름은 두 번 만들 수 없습니다', async () => {
    const reserved = await app.request('POST', '/payroll-payment-items', {
      body: { name: '식대', companyNonTaxableLimit: 100_000 },
    })
    expect(reserved.status).toBe(422)
    expect(reserved.body).toMatchObject({
      code: 'PAYROLL_ITEM_INVALID',
      violations: [
        { field: 'name', code: 'STANDARD_NAME_RESERVED' },
        { field: 'companyNonTaxableLimit', code: 'NOT_APPLICABLE' },
      ],
    })

    const duplicated = await app.request('POST', '/payroll-payment-items', { body: { categoryCode: 'MEAL' } })
    expect(duplicated.status).toBe(422)
    expect(duplicated.body.violations).toEqual([{ field: 'name', code: 'DUPLICATED' }])
  })

  it('If-Match로 고치고, 오래된 버전은 거절합니다', async () => {
    const updated = await app.request('PATCH', `/payroll-payment-items/${mealId}`, {
      headers: { 'if-match': '"1"' },
      body: { companyNonTaxableLimit: 150_000 },
    })
    expect(updated.status).toBe(200)
    expect(updated.headers.get('etag')).toBe('"2"')
    expect(updated.body).toMatchObject({ companyNonTaxableLimit: 150_000, defaultAmount: 250_000 })

    const stale = await app.request('PATCH', `/payroll-payment-items/${mealId}`, {
      headers: { 'if-match': '"1"' },
      body: { prorate: true },
    })
    expect(stale.status).toBe(412)

    const renamed = await app.request('PATCH', `/payroll-payment-items/${mealId}`, { body: { name: '점심값' } })
    expect(renamed.status).toBe(422)
    expect(renamed.body.violations).toEqual([{ field: 'name', code: 'NAME_FIXED' }])
  })

  it('다른 회사의 항목은 없는 것으로 보고, 플랜이 없으면 열지 않습니다', async () => {
    expect((await app.request('GET', `/payroll-payment-items/${mealId}`, { token: 'other-company' })).status).toBe(404)
    const noPlan = await app.request('GET', '/payroll-payment-items', { token: 'no-plan' })
    expect(noPlan.status).toBe(403)
    expect(noPlan.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
    const readOnly = await app.request('POST', '/payroll-payment-items', {
      token: 'reader',
      body: { name: '직책수당' },
    })
    expect(readOnly.status).toBe(403)
  })

  it('세무 기장만 구독한 회사도 대장에 쓸 항목을 만듭니다', async () => {
    const response = await app.request('POST', '/payroll-payment-items', {
      token: 'taxation-only',
      body: { name: '직책수당', includeInOrdinaryWage: true },
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ categoryCode: null, nonTaxableCategory: null, includeInOrdinaryWage: true })
  })
})

describe('공제 항목 카탈로그', () => {
  it('고정 공제와 정산 시 입력 공제를 만듭니다', async () => {
    const fixed = await app.request('POST', '/payroll-deduction-items', { body: { name: '동호회비', amount: 10_000 } })
    expect(fixed.status).toBe(201)
    expect(fixed.body).toMatchObject({ id: expect.stringMatching(/^dit_/), amountMode: 'FIXED', amount: 10_000 })

    const settled = await app.request('POST', '/payroll-deduction-items', {
      body: { name: '선지급금', amountMode: 'ON_SETTLEMENT' },
    })
    expect(settled.status).toBe(201)
    expect(settled.body).toMatchObject({ amountMode: 'ON_SETTLEMENT', amount: null })

    const reserved = await app.request('POST', '/payroll-deduction-items', { body: { name: '소득세', amount: 1 } })
    expect(reserved.status).toBe(422)
    expect(reserved.body.violations).toEqual([{ field: 'name', code: 'RESERVED_NAME' }])
  })
})

describe('급여대장 행과 카탈로그', () => {
  let ledgerId = ''
  let rowId = ''
  let version = 0
  let positionId = ''

  it('정기 대장의 근로 행에 기본 금액이 있는 지급 항목과 고정 공제를 미리 넣습니다', async () => {
    const created = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2026-03' } })
    expect(created.status).toBe(201)
    ledgerId = created.body.id
    version = created.body.version

    const rows = await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)
    const row = rows.body.items[0]
    rowId = row.id
    expect(row.input.paymentItems).toEqual([{ itemId: expect.stringMatching(/^pit_/), amount: 250_000 }])
    expect(row.input.otherDeductions).toEqual([{ itemId: expect.stringMatching(/^dit_/), amount: 10_000 }])
    // 식대 250,000원 중 회사 한도 150,000원만 비과세이고 나머지 100,000원은 과세입니다.
    expect(row.result.payments.find((line: Line) => line.name === '식대')).toMatchObject({
      amount: 250_000,
      nonTaxableAmount: 150_000,
      taxableAmount: 100_000,
    })
    expect(row.result.deductions.find((line: Line) => line.name === '동호회비')).toMatchObject({ amount: 10_000 })
  })

  it('항목 속성을 고치면 다시 계산할 때 새 속성을 씁니다', async () => {
    const meal = (await app.request('GET', '/payroll-payment-items')).body.items.find(
      (item: { name: string }) => item.name === '식대',
    )
    await app.request('PATCH', `/payroll-payment-items/${meal.id}`, { body: { companyNonTaxableLimit: null } })

    const recalculated = await app.request('POST', `/payroll-ledgers/${ledgerId}:recalculate`, {
      headers: { 'if-match': `"${version}"` },
    })
    expect(recalculated.status).toBe(200)
    version = recalculated.body.version
    const row = (await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`)).body.items[0]
    // 회사 한도를 지우면 법정 한도 200,000원까지 비과세입니다.
    expect(row.result.payments.find((line: Line) => line.name === '식대')).toMatchObject({
      nonTaxableAmount: 200_000,
      taxableAmount: 50_000,
    })
  })

  it('카탈로그에 없는 항목을 가리키는 행은 거절합니다', async () => {
    const response = await app.request('PATCH', `/payroll-ledgers/${ledgerId}/rows/${rowId}`, {
      headers: { 'if-match': `"${version}"` },
      body: {
        input: {
          incomeType: 'WAGE_MONTHLY',
          basePay: 3_000_000,
          paymentItems: [{ itemId: 'pit_01JBQ000000000000000000099', amount: 1 }],
        },
      },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({
      code: 'PAYROLL_ROW_ITEM_INVALID',
      violations: [{ field: 'input.paymentItems[0].itemId', code: 'NOT_FOUND' }],
    })
  })

  it('지운 항목은 목록과 새 입력에서 빠지지만 이미 넣은 행은 그대로 계산합니다', async () => {
    positionId = await addPaymentItem(app, { name: '직책수당' })
    const withPosition = await app.request('PATCH', `/payroll-ledgers/${ledgerId}/rows/${rowId}`, {
      headers: { 'if-match': `"${version}"` },
      body: {
        input: {
          incomeType: 'WAGE_MONTHLY',
          basePay: 3_000_000,
          paymentItems: [{ itemId: positionId, amount: 100_000 }],
        },
      },
    })
    expect(withPosition.status).toBe(200)
    version += 1

    expect((await app.request('DELETE', `/payroll-payment-items/${positionId}`)).status).toBe(204)
    expect((await app.request('DELETE', `/payroll-payment-items/${positionId}`)).status).toBe(204)
    const listed = (await app.request('GET', '/payroll-payment-items')).body.items.map(
      (item: { id: string }) => item.id,
    )
    expect(listed).not.toContain(positionId)
    const archived = await app.request('GET', '/payroll-payment-items?includeArchived=true')
    expect(archived.body.items).toContainEqual(
      expect.objectContaining({ id: positionId, archivedAt: expect.any(String) }),
    )
    const patched = await app.request('PATCH', `/payroll-payment-items/${positionId}`, { body: { prorate: true } })
    expect(patched.status).toBe(409)
    expect(patched.body).toMatchObject({ code: 'PAYROLL_ITEM_ARCHIVED' })

    const kept = await app.request('PATCH', `/payroll-ledgers/${ledgerId}/rows/${rowId}`, {
      headers: { 'if-match': `"${version}"` },
      body: {
        input: {
          incomeType: 'WAGE_MONTHLY',
          basePay: 3_100_000,
          paymentItems: [{ itemId: positionId, amount: 120_000 }],
        },
      },
    })
    expect(kept.status).toBe(200)
    version += 1
    expect(kept.body.result.payments).toContainEqual(
      expect.objectContaining({ code: positionId, name: '직책수당', amount: 120_000, taxableAmount: 120_000 }),
    )
  })

  it('지운 항목을 새 행에 넣으면 거절합니다', async () => {
    const response = await app.request('POST', '/payroll-ledgers', { body: { attributionMonth: '2026-04' } })
    const otherRow = (await app.request('GET', `/payroll-ledgers/${response.body.id}/rows`)).body.items[0]
    const rejected = await app.request('PATCH', `/payroll-ledgers/${response.body.id}/rows/${otherRow.id}`, {
      headers: { 'if-match': `"${response.body.version}"` },
      body: {
        input: { incomeType: 'WAGE_MONTHLY', basePay: 3_000_000, paymentItems: [{ itemId: positionId, amount: 1 }] },
      },
    })

    expect(rejected.status).toBe(422)
    expect(rejected.body.violations).toEqual([{ field: 'input.paymentItems[0].itemId', code: 'ARCHIVED' }])
  })

  it('계산기도 회사 카탈로그로 항목을 풉니다', async () => {
    const response = await app.request('POST', '/payroll-calculator:simulate', {
      body: {
        attributionMonth: '2026-03',
        row: {
          incomeType: 'WAGE_MONTHLY',
          basePay: 3_000_000,
          paymentItems: [{ itemId: positionId, amount: 1 }],
        },
      },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'PAYROLL_ROW_ITEM_INVALID' })
  })
})
