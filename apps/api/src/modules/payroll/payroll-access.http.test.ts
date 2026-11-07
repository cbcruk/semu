import { afterAll, describe, expect, it } from 'vitest'
import type { Plan } from '../identity-access/actor.types.ts'
import { TEST_COMPANY_ID, testActor } from '../identity-access/testing.ts'
import { payrollTestApp } from './payroll-testing.ts'
import { rateBasedSetting, testEmployee } from './payroll-test-fixtures.ts'
import { PayrollEmployeeDirectory } from './ports/payroll-employee-directory.ts'
import { PayrollSettingRepository } from './settings/payroll-setting-repository.ts'

/**
 * 급여대장·행·명세서·인건비 보고서는 `PAYROLL`이나 `TAXATION` 중 하나면 열고(2026-11-07 결정), 급여 설정·퇴직금·기준표·
 * 계산기는 현행 메뉴처럼 `PAYROLL`만 엽니다. 토큰마다 같은 회사의 다른 구독을 흉내 냅니다.
 */
const PLAN_CASES: ReadonlyArray<readonly [token: string, plans: ReadonlyArray<Plan>, attributionMonth: string]> = [
  ['payroll-only', ['PAYROLL'], '2026-04'],
  ['taxation-only', ['TAXATION'], '2026-05'],
  ['both-plans', ['TAXATION', 'PAYROLL'], '2026-06'],
]

const app = payrollTestApp(
  [
    PayrollEmployeeDirectory.layerMemory([{ companyId: TEST_COMPANY_ID, employee: testEmployee() }]),
    PayrollSettingRepository.layerMemory([{ companyId: TEST_COMPANY_ID, setting: rateBasedSetting() }]),
  ],
  [
    ...PLAN_CASES.map(([token, plans]) => [token, testActor({ plans: new Set(plans) })] as const),
    ['no-plan', testActor({ plans: new Set() })],
    ['taxation-terms-pending', testActor({ plans: new Set(['TAXATION']), pendingTermCodes: ['TAX_SERVICE'] })],
  ],
)

afterAll(() => app.dispose())

describe('payroll plan gate', () => {
  for (const [token, , attributionMonth] of PLAN_CASES) {
    it(`opens ledgers, rows, payslips and the labor-cost report to ${token}`, async () => {
      const created = await app.request('POST', '/payroll-ledgers', { token, body: { attributionMonth } })
      expect(created.status).toBe(201)
      const ledgerId = created.body.id

      const row = await app.request('POST', `/payroll-ledgers/${ledgerId}/rows`, {
        token,
        body: { payeeName: '박프리', input: { incomeType: 'BUSINESS', payAmount: 1_000_000 } },
      })
      expect(row.status).toBe(201)
      expect((await app.request('GET', `/payroll-ledgers/${ledgerId}/rows`, { token })).status).toBe(200)
      expect(
        (await app.request('GET', `/payroll-ledgers?attributionMonth=${attributionMonth}`, { token })).status,
      ).toBe(200)
      expect((await app.request('POST', `/payroll-ledgers/${ledgerId}:close`, { token })).status).toBe(200)

      const payslips = await app.request('GET', `/payslips?ledgerId=${ledgerId}`, { token })
      expect(payslips.status).toBe(200)
      expect(payslips.body.items).toHaveLength(2)
      const sent = await app.request('POST', '/payslips:send', {
        token,
        headers: { 'idempotency-key': `plan-${token}` },
        body: { payslipIds: payslips.body.items.map((item: { id: string }) => item.id) },
      })
      expect(sent.status).toBe(202)

      expect((await app.request('GET', '/labor-cost-reports/2026', { token })).status).toBe(200)
    })
  }

  it('refuses a company with neither plan and names both plans', async () => {
    const paths: ReadonlyArray<readonly [string, string]> = [
      ['GET', '/payroll-ledgers'],
      ['POST', '/payroll-ledgers'],
      ['GET', '/payslips'],
      ['GET', '/labor-cost-reports/2026'],
    ]
    for (const [method, path] of paths) {
      const response = await app.request(method, path, {
        token: 'no-plan',
        ...(method === 'POST' ? { body: { attributionMonth: '2026-07' } } : {}),
      })

      expect(response.status, `${method} ${path}`).toBe(403)
      expect(response.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['PAYROLL', 'TAXATION'] })
    }
    const send = await app.request('POST', '/payslips:send', {
      token: 'no-plan',
      headers: { 'idempotency-key': 'plan-no-plan' },
      body: { payslipIds: ['psl_01JBQ000000000000000000001'] },
    })
    expect(send.status).toBe(403)
    expect(send.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['PAYROLL', 'TAXATION'] })
  })

  it('asks a taxation-only company for the tax terms it can agree to, not for a payroll term', async () => {
    const response = await app.request('GET', '/payroll-ledgers', { token: 'taxation-terms-pending' })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'TERMS_REAGREEMENT_REQUIRED', termCodes: ['TAX_SERVICE'] })
  })

  it('keeps settings, severance, rate tables and the calculator to the payroll plan', async () => {
    const paths = ['/payroll-settings', '/severance-settlements', '/rate-tables', '/payroll-reference-codes']
    for (const path of paths) {
      const response = await app.request('GET', path, { token: 'taxation-only' })

      expect(response.status, path).toBe(403)
      expect(response.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['PAYROLL'] })
    }
    const simulate = await app.request('POST', '/payroll-calculator:simulate', {
      token: 'taxation-only',
      body: { attributionMonth: '2026-03', row: { incomeType: 'WAGE_MONTHLY', basePay: 3_000_000 } },
    })
    expect(simulate.status).toBe(403)
    expect(simulate.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['PAYROLL'] })
  })
})
