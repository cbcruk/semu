import { describe, expect, it } from 'vitest'
import {
  countDependantsAsOf,
  findDeductionInfoAsOf,
  findEmployee,
  findPayrollContractAsOf,
  findRetirementInfo,
  findSocialInsuranceAsOf,
  findWorkContractAsOf,
  getEmployeeStatusAsOf,
  listEmployees,
  listEmployeesEmployedBetween,
  listLeavesOverlapping,
  revealRegistrationNumber,
  setSeveranceSettlementStatus,
} from '../../src/modules/hr/employees/employees.repository'
import { toPlainDate } from '../../src/lib/plain-date'
import { CORP } from '../helpers/test-app'
import { hrSuite, json, seededId, WAGE } from './hr-fixtures'

const TODAY = toPlainDate('2026-11-01')

describe('payroll repository contract', () => {
  it('reads employees and their status as of a date', async () => {
    const suite = await hrSuite()
    const resigned = seededId(suite, '박지훈')
    const record = findEmployee(suite.db, CORP, resigned, TODAY)
    expect(record).toMatchObject({ name: '박지훈', kind: 'wage-salary', joinDate: '2021-01-04', leaveDate: '2025-12-31', hasRegistrationNumber: true })
    expect(getEmployeeStatusAsOf(suite.db, CORP, resigned, toPlainDate('2025-06-30'))).toBe('JOINED')
    expect(getEmployeeStatusAsOf(suite.db, CORP, resigned, TODAY)).toBe('RESIGNED')
    expect(getEmployeeStatusAsOf(suite.db, CORP, seededId(suite, '이서연'), TODAY)).toBe('LEAVE')

    expect(listEmployees(suite.db, CORP, TODAY).map((row) => row.name)).toEqual(['김민준', '박지훈', '이서연', '최유진'])
    const october = listEmployeesEmployedBetween(suite.db, CORP, toPlainDate('2026-10-01'), toPlainDate('2026-10-31')).map((row) => row.name)
    expect(october).toEqual(['김민준', '이서연', '최유진'])
    expect(revealRegistrationNumber(suite.db, suite.cipher, CORP, resigned)).toBe('8501071456789')
  })

  it('reads effective-dated contracts and settings', async () => {
    const suite = await hrSuite()
    const id = seededId(suite, '김민준')
    expect(findWorkContractAsOf(suite.db, CORP, id, TODAY)).toMatchObject({ contract_type: 'regular', weekly_work_hours: 40 })
    expect(findWorkContractAsOf(suite.db, CORP, id, toPlainDate('2023-01-01'))).toBeUndefined()
    const payroll = findPayrollContractAsOf(suite.db, suite.cipher, CORP, id, TODAY)
    expect(payroll).toMatchObject({ wage_type: 'monthly', amount: 4_200_000 })
    expect(payroll?.account_number).toMatch(/^1002\d{8}$/)

    await json(await suite.call(suite.admin, 'PUT', `${WAGE}/${id}/deduction-info`, { json: { income_tax_rate: 120, effective_date: '2027-01-01' } }), 200)
    expect(findDeductionInfoAsOf(suite.db, CORP, id, TODAY)).toBeUndefined()
    expect(findDeductionInfoAsOf(suite.db, CORP, id, toPlainDate('2027-02-01'))?.income_tax_rate).toBe(120)
    await json(await suite.call(suite.admin, 'PUT', `${WAGE}/${id}/social-insurance-info`, { json: { ei_enrolled: false, effective_date: '2026-10-01' } }), 200)
    expect(findSocialInsuranceAsOf(suite.db, CORP, id, TODAY)?.ei_enrolled).toBe(0)
    expect(countDependantsAsOf(suite.db, CORP, id, TODAY)).toMatchObject({ dependents_count: 1, children_8_to_20_count: 0 })
  })

  it('reads leaves and records severance settlement', async () => {
    const suite = await hrSuite()
    const onLeave = seededId(suite, '이서연')
    expect(listLeavesOverlapping(suite.db, CORP, onLeave, toPlainDate('2026-10-01'), toPlainDate('2026-10-31'))).toHaveLength(1)
    expect(listLeavesOverlapping(suite.db, CORP, onLeave, toPlainDate('2026-01-01'), toPlainDate('2026-01-31'))).toHaveLength(0)

    const resigned = seededId(suite, '박지훈')
    expect(setSeveranceSettlementStatus(suite.db, CORP, resigned, 'in_progress', suite.clock.now())).toBe(true)
    expect(findRetirementInfo(suite.db, CORP, resigned)?.severance_settlement_status).toBe('in_progress')
    expect(setSeveranceSettlementStatus(suite.db, CORP, seededId(suite, '김민준'), 'completed', suite.clock.now())).toBe(false)
  })
})
