import type { DatabaseSync } from 'node:sqlite'
import { execute, queryOne } from '../../db/query'
import { SEED } from '../../db/seed'
import type { SeedContext } from '../../db/seed.types'
import { addDays, addMonths, toPlainDate } from '../../lib/plain-date'
import type { PlainDate } from '../../lib/plain-date.types'
import { insertPayrollContract, insertWorkContract } from './contracts/contracts.repository'
import { payrollContractBody, workContractBody } from './contracts/contracts.schema'
import { toPayrollContractWrite, toWorkContractWrite } from './contracts/contracts.service'
import { seedESignDemo } from './e-sign/e-sign.seed'
import { insertEmployee, markOrganizationUsed } from './employees/employees.repository'
import { insertLeave } from './leaves/leaves.repository'
import { upsertRetirementInfo } from './retirement/retirement.repository'
import { birthDateFromRegistrationNumber, normalizeIdentificationNumber, protectIdentificationNumber } from './shared/registration-number'

/** Demo departments and positions of the corporate company, in display order. Names are product data. */
export const HR_SEED_ORGANIZATION = {
  departments: ['경영지원팀', '개발팀', '디자인팀'],
  positions: ['대표', '팀장', '매니저', '사원'],
} as const

interface SeedEmployee {
  name: string
  registrationNumber: string
  email: string
  joinDate: PlainDate
  department: string
  position: string
}

/**
 * Inserts the HR demo fixtures for the corporate company.
 *
 * - 김민준: regular employee with work and payroll contracts, and the draft e-sign request.
 * - 이서연: on parental leave today.
 * - 박지훈: resigned at the end of last year.
 * - 최유진: fixed-term contract ending within the 30-day warning window.
 *
 * Dates are relative to the seed time so the statuses hold whenever the seed
 * runs. Writes go straight to the repositories because the caller already
 * holds the seed transaction, and no file blobs are written.
 */
export function seedHrDemo(db: DatabaseSync, context: SeedContext): void {
  const companyId = SEED.companies.corp
  const userId = SEED.users.admin
  const today = toPlainDate(context.now.slice(0, 10))
  const departments = insertUnits(db, 'departments', companyId, HR_SEED_ORGANIZATION.departments, context.now)
  const positions = insertUnits(db, 'positions', companyId, HR_SEED_ORGANIZATION.positions, context.now)

  const add = (employee: SeedEmployee): number => {
    const normalized = normalizeIdentificationNumber(employee.registrationNumber, 'registration')
    if (normalized === null) throw new Error(`Invalid demo registration number for ${employee.name}.`)
    const protectedNumber = protectIdentificationNumber(db, context.cipher, normalized, context.now)
    const departmentId = departments.get(employee.department) ?? null
    const positionId = positions.get(employee.position) ?? null
    const id = insertEmployee(
      db,
      companyId,
      'wage-salary',
      {
        name: employee.name,
        english_name: null,
        registration_number_enc: protectedNumber.encrypted,
        registration_number_hash: protectedNumber.hash,
        identification_number_type: 'registration',
        birth_date: birthDateFromRegistrationNumber(normalized),
        email: employee.email,
        phone: null,
        is_local: 1,
        nationality: null,
        visa: null,
        is_residence: 1,
        country_of_residence: '대한민국',
        employee_number: null,
        department_id: departmentId,
        position_id: positionId,
        join_date: employee.joinDate,
        work_code: null,
        is_rejoin: 0,
      },
      'manual',
      userId,
      context.now,
    )
    markOrganizationUsed(db, companyId, departmentId, positionId)
    return id
  }
  const contract = (employeeId: number, holder: string, input: Record<string, unknown>, monthlyWage: number): void => {
    const work = workContractBody.parse(input)
    insertWorkContract(db, companyId, employeeId, toWorkContractWrite(work), context.now)
    const payroll = payrollContractBody.parse({ start_date: work.start_date, end_date: work.end_date, wage_type: 'monthly', amount: monthlyWage, bank_code: '004', account_number: `1002${String(employeeId).padStart(8, '0')}`, account_holder: holder })
    insertPayrollContract(db, companyId, employeeId, toPayrollContractWrite({ db, cipher: context.cipher }, { company_id: companyId, id: employeeId }, payroll, null).values, context.now)
  }

  const regularJoin = toPlainDate('2023-03-02')
  const regular = add({ name: '김민준', registrationNumber: '880315-1234567', email: 'minjun@example.com', joinDate: regularJoin, department: '개발팀', position: '팀장' })
  contract(regular, '김민준', { contract_type: 'regular', start_date: regularJoin, weekly_work_hours: 40, job_description: '서비스 개발 총괄' }, 4_200_000)

  const onLeaveJoin = toPlainDate('2022-05-09')
  const onLeave = add({ name: '이서연', registrationNumber: '920822-2345678', email: 'seoyeon@example.com', joinDate: onLeaveJoin, department: '디자인팀', position: '매니저' })
  contract(onLeave, '이서연', { contract_type: 'regular', start_date: onLeaveJoin, weekly_work_hours: 40, job_description: '프로덕트 디자인' }, 3_500_000)
  const leaveStart = addDays(today, -60)
  insertLeave(
    db,
    companyId,
    onLeave,
    {
      reason: 'parental',
      start_date: leaveStart,
      end_date: addDays(leaveStart, 364),
      expected_return_date: addDays(leaveStart, 365),
      actual_return_date: null,
      is_paid: 0,
      paid_allowance: null,
      include_in_service_years: 1,
      nps_payment_exception: 1,
      nhis_notice_deferral: 1,
    },
    context.now,
  )

  const resignedJoin = toPlainDate('2021-01-04')
  const resigned = add({ name: '박지훈', registrationNumber: '850107-1456789', email: 'jihun@example.com', joinDate: resignedJoin, department: '경영지원팀', position: '매니저' })
  contract(resigned, '박지훈', { contract_type: 'regular', start_date: resignedJoin, weekly_work_hours: 40, job_description: '재무·회계' }, 3_800_000)
  upsertRetirementInfo(
    db,
    companyId,
    resigned,
    {
      retirement_benefit_type: 'grant',
      has_interim_settlement: 0,
      interim_settlement_date: null,
      interim_settlement_reason: null,
      leave_date: toPlainDate('2025-12-31'),
      leaving_reason: '11',
      leaving_detail_reason: '11-1',
      severance_amount: 18_500_000,
    },
    context.now,
  )

  const fixedTermStart = addMonths(today, -11)
  const fixedTerm = add({ name: '최유진', registrationNumber: '990604-2567890', email: 'yujin@example.com', joinDate: fixedTermStart, department: '경영지원팀', position: '사원' })
  contract(fixedTerm, '최유진', { contract_type: 'contract', start_date: fixedTermStart, end_date: addDays(today, 20), weekly_work_hours: 40, job_description: '인사·총무 지원' }, 2_600_000)

  seedESignDemo(db, context, { companyId, userId, employeeId: regular })
}

function insertUnits(db: DatabaseSync, table: 'departments' | 'positions', companyId: string, names: readonly string[], now: string): Map<string, number> {
  const ids = new Map<string, number>()
  names.forEach((name, index) => {
    execute(db, `INSERT INTO ${table} (company_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, [companyId, name, index, now, now])
    const row = queryOne<{ id: number }>(db, `SELECT id FROM ${table} WHERE company_id = ? AND name = ?`, [companyId, name])
    if (row !== undefined) ids.set(name, row.id)
  })
  return ids
}
