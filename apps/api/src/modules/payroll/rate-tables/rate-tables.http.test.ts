import { afterAll, describe, expect, it } from 'vitest'
import { addPaymentItem, payrollTestApp } from '../payroll-testing.ts'

const app = payrollTestApp()

afterAll(() => app.dispose())

describe('/rate-tables', () => {
  it('내장 기준표를 미확인 값 경로와 함께 보여 줍니다', async () => {
    const response = await app.request('GET', '/rate-tables')

    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { effectiveFrom: string }) => item.effectiveFrom)).toEqual([
      '2026-01',
      '2026-03',
      '2026-07',
      '2026-11',
    ])
    expect(response.body.items[0]).toMatchObject({
      id: 'rtb_00000000000000000000202601',
      minimumWage: { hourly: 10_320, monthly: 2_156_880 },
    })
    expect(response.body.items[0].unverifiedPaths).toContain('employmentInsurance.premiumRoundingUnit')
    expect(response.body.items[0].unverifiedPaths).not.toContain('longTermCare.ratioOfHealthPpm')
    expect(response.body.items[2]).toMatchObject({ nationalPension: { baseMin: 410_000, baseMax: 6_590_000 } })
    expect(response.body.items[2].unverifiedPaths).not.toContain('nationalPension.baseMax')
    expect(response.body.items[3].unverifiedPaths).not.toContain('longTermCare.ratioOfHealthPpm')
  })

  it('그달 시행 중인 기준표를 고릅니다', async () => {
    const response = await app.request('GET', '/rate-tables?month=2026-09')

    expect(response.body.items.map((item: { effectiveFrom: string }) => item.effectiveFrom)).toEqual(['2026-07'])
  })

  it('모든 기준표보다 앞선 달이면 422로 답합니다', async () => {
    const response = await app.request('GET', '/rate-tables?month=2020-01')

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'RATE_TABLE_NOT_FOUND', month: '2020-01' })
  })

  it('지급명세서 서식의 기타소득 코드를 필요경비율과 함께 보여 줍니다', async () => {
    const response = await app.request('GET', '/payroll-reference-codes?month=2026-03')
    const other = (code: string) => response.body.otherIncome.find((entry: { code: string }) => entry.code === code)

    expect(response.status).toBe(200)
    expect(other('60')).toMatchObject({ name: '필요경비가 없는 기타소득', expenseRatePpm: 0, verified: true })
    expect(other('76')).toMatchObject({ expenseRatePpm: 600_000, taxRatePpm: 200_000 })
    expect(other('64')).toMatchObject({ name: '서화·골동품 양도소득', expenseRatePpm: 900_000 })
    expect(other('63')).toMatchObject({ taxRatePpm: 150_000 })
  })

  it('지급명세서 서식의 사업소득 코드 40개를 보여 줍니다', async () => {
    const response = await app.request('GET', '/payroll-reference-codes?month=2026-03')

    expect(response.body.businessIncome).toHaveLength(40)
    expect(response.body.businessIncome.every((entry: { verified: boolean }) => entry.verified)).toBe(true)
    expect(response.body.businessIncome).toContainEqual(
      expect.objectContaining({ code: '940909', name: '기타인적용역자' }),
    )
  })
})

describe('/payroll-calculator:simulate', () => {
  it('월급제 근로소득 행을 4대보험 요율과 공식 간이세액표대로 계산합니다', async () => {
    const mealId = await addPaymentItem(app, { categoryCode: 'MEAL' })
    const response = await app.request('POST', '/payroll-calculator:simulate', {
      body: {
        attributionMonth: '2026-03',
        row: {
          incomeType: 'WAGE_MONTHLY',
          basePay: 3_000_000,
          paymentItems: [{ itemId: mealId, amount: 200_000 }],
        },
      },
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      grossPay: 3_200_000,
      taxablePay: 3_000_000,
      employeeInsurance: {
        nationalPension: 142_500,
        healthInsurance: 107_850,
        longTermCare: 14_170,
        employmentInsurance: 27_000,
      },
      incomeTax: 74_350,
      localIncomeTax: 7_430,
      netPay: 2_826_700,
    })
  })

  it('보육수당 한도를 자녀 1명당 적용하고 자녀 수의 범위를 제한합니다', async () => {
    const childcareId = await addPaymentItem(app, { categoryCode: 'CHILDCARE' })
    const employee = {
      dependants: 1,
      childrenAged8To20: 0,
      withholdingRatePpm: 1_000_000,
      manualIncomeTax: null,
      socialInsurance: { nationalPension: true, healthInsurance: true, employmentInsurance: true },
      monthlyStandardHours: 209,
      dailyRestMinutes: 480,
    }
    const row = {
      incomeType: 'WAGE_MONTHLY',
      basePay: 3_000_000,
      paymentItems: [{ itemId: childcareId, amount: 500_000 }],
    }
    const simulate = (childcareChildren: number) =>
      app.request('POST', '/payroll-calculator:simulate', {
        body: { attributionMonth: '2026-03', row, employee: { ...employee, childcareChildren } },
      })

    const two = await simulate(2)
    expect(two.status).toBe(200)
    expect(two.body).toMatchObject({ nonTaxablePay: 400_000 })
    expect((await simulate(20)).status).toBe(200)
    expect((await simulate(21)).status).toBe(400)
    expect((await simulate(-1)).status).toBe(400)
  })

  it('사업소득 지급액을 실지급액에서 역산합니다', async () => {
    const response = await app.request('POST', '/payroll-calculator:simulate', {
      body: {
        attributionMonth: '2026-03',
        row: { incomeType: 'BUSINESS', payAmount: 967_000, taxDeductionMode: 'AFTER_TAX' },
      },
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ grossPay: 1_000_000, netPay: 967_000 })
  })
})
