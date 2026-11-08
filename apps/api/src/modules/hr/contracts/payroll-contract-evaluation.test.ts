import { describe, expect, it } from 'vitest'
import { evaluatePayrollContract } from './payroll-contract-evaluation.ts'
import { MINIMUM_HOURLY_WAGE_2026 } from './wage-calculation.ts'

const context = { minimumHourlyWage: MINIMUM_HOURLY_WAGE_2026 }
const monthly = { startDate: '2026-01-01', wageType: 'MONTHLY', amount: 3_000_000, monthlyWorkHours: 209 } as const

describe('급여계약 검사', () => {
  it('경고 없이 기본급과 시급들을 계산합니다', () => {
    const result = evaluatePayrollContract(monthly, context)

    expect(result.violations).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.derived).toMatchObject({
      baseSalary: 3_000_000,
      baseHourlyWage: 14354.07,
      statutoryMinimumHourlyWage: 10_320,
      fixedAllowanceAmounts: { overtime: 0, night: 0, holiday: 0, holidayOvertime: 0 },
    })
  })

  it('수습이 3개월을 넘고 감액한 수습 시급이 최저시급보다 낮으면 경고합니다', () => {
    const atMinimum = { ...monthly, amount: 2_156_880 }
    const reduced = { ...context, probationPayRatePpm: 900_000 }

    expect(evaluatePayrollContract(atMinimum, { ...reduced, probationMonths: 3 }).warnings).toEqual([])
    expect(evaluatePayrollContract(atMinimum, { ...reduced, probationMonths: 6 }).warnings).toEqual([
      'PROBATION_BELOW_MINIMUM_WAGE',
    ])
    expect(evaluatePayrollContract(monthly, { ...reduced, probationMonths: 6 }).warnings).toEqual([])
  })

  it('최저임금 미달은 거부하지 않고 경고합니다', () => {
    const result = evaluatePayrollContract({ ...monthly, amount: 2_156_879 }, context)

    expect(result.violations).toEqual([])
    expect(result.warnings).toEqual(['BELOW_MINIMUM_WAGE'])
  })

  it('입력에서 빠진 고정수당은 끈 것으로 채웁니다', () => {
    const result = evaluatePayrollContract(
      { ...monthly, fixedAllowances: { overtime: { enabled: true, hours: 10, amount: 300_000 } } },
      context,
    )

    expect(result.derived.baseSalary).toBe(2_700_000)
    expect(result.derived.fixedAllowanceAmounts).toEqual({
      overtime: 300_000,
      night: 0,
      holiday: 0,
      holidayOvertime: 0,
    })
  })

  it('근로계약의 수습 지급률로 수습시급을 더합니다', () => {
    const result = evaluatePayrollContract(monthly, { ...context, probationPayRatePpm: 900_000 })

    expect(result.derived.probationHourlyWage).toBe(12918.66)
  })

  it('시작일보다 앞선 종료일과 음수 기본급을 거부합니다', () => {
    const result = evaluatePayrollContract(
      {
        ...monthly,
        endDate: '2025-12-31',
        paymentItems: [{ amount: 3_100_000, enabled: true }],
      },
      context,
    )

    expect(result.violations).toEqual([
      { field: 'endDate', code: 'END_BEFORE_START' },
      { field: 'amount', code: 'BASE_SALARY_NEGATIVE' },
    ])
  })
})
