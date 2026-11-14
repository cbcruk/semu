import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import {
  decidePayrollContractCreation,
  decidePayrollContractSigning,
  decidePayrollContractUpdate,
  type PayrollContractFacts,
} from './payroll-contract.aggregate.ts'
import type { PayrollContractInput, PayrollContractRecord } from './payroll-contract.ts'
import type { WorkContractRecord } from './work-contract.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>
const EMPLOYEE = 'emp_01JBQ000000000000000000001' as Id<'employee'>
const CONTRACT = 'pct_01JBQ000000000000000000001' as Id<'payrollContract'>
const SIGNED = 'doc_01JBQ000000000000000000001' as Id<'document'>
const AT = '2026-11-14T01:00:00.000Z'
const LATER = '2026-11-15T01:00:00.000Z'
const TERMS: PayrollContractInput = {
  startDate: '2026-01-02',
  wageType: 'MONTHLY',
  amount: 3_000_000,
  monthlyWorkHours: 209,
}
const FACTS: PayrollContractFacts = { workContracts: [], hasFiveOrMoreEmployees: true }
const ACCOUNT = {
  bankCode: '004',
  accountNumberEncrypted: 'enc',
  accountNumberMasked: '1234-****',
  accountHolder: '홍길동',
}

function created(terms: PayrollContractInput = TERMS, facts: PayrollContractFacts = FACTS): PayrollContractRecord {
  const result = decidePayrollContractCreation(
    { id: CONTRACT, companyId: COMPANY, employeeId: EMPLOYEE, employeeKind: 'WAGE', terms },
    facts,
    AT,
  )
  if (Result.isFailure(result)) throw result.failure
  return result.success.payrollContract
}

describe('급여계약 생성 판정', () => {
  it('파생 금액을 계산하고 봉인한 계좌를 담습니다', () => {
    const contract = created(
      { ...TERMS, account: { bankCode: '004', accountNumber: '1234-5678', accountHolder: '홍길동' } },
      { ...FACTS, account: ACCOUNT },
    )
    expect(contract).toMatchObject({ derived: { baseSalary: 3_000_000 }, account: ACCOUNT, version: 1, createdAt: AT })
    expect(JSON.stringify(contract)).not.toContain('1234-5678')
  })

  it('수습 지급률은 계약 시작일에 유효한 근로계약에서 가져옵니다', () => {
    const work: WorkContractRecord = {
      id: 'wct_1' as Id<'workContract'>,
      companyId: COMPANY,
      employeeId: EMPLOYEE,
      contractType: 'PERMANENT',
      startDate: '2026-01-02',
      probation: { months: 3, payRatePpm: 900_000 },
      createdAt: AT,
    }
    expect(created(TERMS, { ...FACTS, workContracts: [work] }).derived.probationHourlyWage).toBe(12918.66)
  })

  it('근로소득자가 아니면 평가 전에 거부합니다', () => {
    const result = decidePayrollContractCreation(
      {
        id: CONTRACT,
        companyId: COMPANY,
        employeeId: EMPLOYEE,
        employeeKind: 'BUSINESS',
        terms: { ...TERMS, endDate: '2025-01-01' },
      },
      FACTS,
      AT,
    )
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'EmployeeKindNotSupported',
      kind: 'BUSINESS',
    })
  })

  it('시작일보다 앞선 종료일을 거부합니다', () => {
    const result = decidePayrollContractCreation(
      {
        id: CONTRACT,
        companyId: COMPANY,
        employeeId: EMPLOYEE,
        employeeKind: 'WAGE',
        terms: { ...TERMS, endDate: '2025-12-31' },
      },
      FACTS,
      AT,
    )
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'PayrollContractInvalid',
      violations: [{ field: 'endDate', code: 'END_BEFORE_START' }],
    })
  })
})

describe('급여계약 수정 판정', () => {
  const signed = { ...created(), signedDocumentId: SIGNED }

  it('계좌만 바꾸면 서명 문서를 남깁니다', () => {
    const result = decidePayrollContractUpdate(
      signed,
      { ...TERMS, account: { bankCode: '004', accountNumber: '1234-5678', accountHolder: '홍길동' } },
      { ...FACTS, account: ACCOUNT },
      LATER,
    )
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.payrollContract).toMatchObject({
      signedDocumentId: SIGNED,
      version: 2,
      createdAt: AT,
      updatedAt: LATER,
    })
  })

  it('근로조건을 바꾸면 서명 연결을 풉니다', () => {
    const result = decidePayrollContractUpdate(signed, { ...TERMS, amount: 3_100_000 }, FACTS, LATER)
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.payrollContract.signedDocumentId).toBeUndefined()
  })
})

describe('급여계약 서명 연결 판정', () => {
  it('연결을 바꾸면 버전을 올리고, 다른 문서를 가리키면 풀지 않습니다', () => {
    const linked = decidePayrollContractSigning(created(), SIGNED, LATER)?.payrollContract
    expect(linked).toMatchObject({ signedDocumentId: SIGNED, version: 2, updatedAt: LATER })
    expect(decidePayrollContractSigning(linked!, undefined, LATER, 'doc_other' as Id<'document'>)).toBeUndefined()
  })
})
