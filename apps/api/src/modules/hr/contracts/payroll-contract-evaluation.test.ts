import { describe, expect, it } from 'vitest'
import { evaluatePayrollContract } from './payroll-contract-evaluation.ts'
import { MINIMUM_HOURLY_WAGE_2026 } from './wage-calculation.ts'

const context = { minimumHourlyWage: MINIMUM_HOURLY_WAGE_2026 }
const monthly = { startDate: '2026-01-01', wageType: 'MONTHLY', amount: 3_000_000, monthlyWorkHours: 209 } as const

describe('evaluatePayrollContract', () => {
  it('derives the base salary and hourly wages without warnings', () => {
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

  it('warns instead of failing below the minimum wage', () => {
    const result = evaluatePayrollContract({ ...monthly, amount: 2_156_879 }, context)

    expect(result.violations).toEqual([])
    expect(result.warnings).toEqual(['BELOW_MINIMUM_WAGE'])
  })

  it('fills fixed allowances that were left out as disabled', () => {
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

  it('adds the probation hourly wage from the work contract pay rate', () => {
    const result = evaluatePayrollContract(monthly, { ...context, probationPayRatePpm: 900_000 })

    expect(result.derived.probationHourlyWage).toBe(12918.66)
  })

  it('rejects an end before the start and a negative base salary', () => {
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
