import type { Id } from '../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID } from '../identity-access/testing.ts'
import { evaluatePayrollContract } from './contracts/payroll-contract-evaluation.ts'
import type { PayrollContractRecord } from './contracts/payroll-contract.ts'
import { MINIMUM_HOURLY_WAGE_2026 } from './contracts/wage-calculation.ts'
import type { WorkContractRecord } from './contracts/work-contract.ts'
import type { EmployeeRecord } from './employees/employee.ts'
import type { OrganizationUnitRecord } from './organization/organization.ts'
import type { TaxWithholdingRecord } from './tax-withholding/tax-withholding.ts'

/** 데모 데이터의 회사입니다. Identity & Access의 데모 법인(`DEMO_COMPANY_IDS.corporation`)과 같아서 급여·문서가 같은 직원을 봅니다. */
export const DEMO_COMPANY_ID: Id<'company'> = TEST_COMPANY_ID

const createdAt = '2026-01-02T00:00:00.000Z'

/** 데모 부서·직위입니다. */
export const DEMO_ORGANIZATION: ReadonlyArray<OrganizationUnitRecord> = [
  {
    id: 'dpt_01JBQ00000000000000000D3M1' as Id<'department'>,
    companyId: DEMO_COMPANY_ID,
    kind: 'DEPARTMENT',
    name: '경영지원팀',
    order: 0,
    everAssigned: true,
    version: 1,
  },
  {
    id: 'pos_01JBQ00000000000000000D3M1' as Id<'position'>,
    companyId: DEMO_COMPANY_ID,
    kind: 'POSITION',
    name: '매니저',
    order: 0,
    everAssigned: true,
    version: 1,
  },
]

/** 데모 직원입니다. 한 명은 주민번호가 없어 경고가 보입니다. */
export const DEMO_EMPLOYEES: ReadonlyArray<EmployeeRecord> = [
  {
    id: 'emp_01JBQ00000000000000000D3M1' as Id<'employee'>,
    companyId: DEMO_COMPANY_ID,
    kind: 'WAGE',
    name: '김세무',
    joinDate: '2025-03-02',
    isRejoin: false,
    departmentId: 'dpt_01JBQ00000000000000000D3M1' as Id<'department'>,
    positionId: 'pos_01JBQ00000000000000000D3M1' as Id<'position'>,
    email: 'kim@example.com',
    isForeigner: false,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: 'emp_01JBQ00000000000000000D3M2' as Id<'employee'>,
    companyId: DEMO_COMPANY_ID,
    kind: 'BUSINESS',
    name: '이프리',
    joinDate: '2026-01-02',
    isRejoin: false,
    isForeigner: false,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  },
]

/** 데모 근로계약입니다. */
export const DEMO_WORK_CONTRACTS: ReadonlyArray<WorkContractRecord> = [
  {
    id: 'wct_01JBQ00000000000000000D3M1' as Id<'workContract'>,
    companyId: DEMO_COMPANY_ID,
    employeeId: 'emp_01JBQ00000000000000000D3M1' as Id<'employee'>,
    contractType: 'FIXED_TERM',
    startDate: '2025-03-02',
    endDate: '2027-03-01',
    weeklyWorkHours: 40,
    createdAt,
  },
]

const demoPayrollTerms = {
  startDate: '2025-03-02',
  wageType: 'MONTHLY',
  amount: 3_400_000,
  monthlyWorkHours: 209,
  monthlyWorkHoursSource: 'MANUAL',
  payTiming: { month: 'CURRENT', day: 25 },
  payMethod: 'TRANSFER',
} as const
const demoPayrollEvaluation = evaluatePayrollContract(demoPayrollTerms, { minimumHourlyWage: MINIMUM_HOURLY_WAGE_2026 })

/**
 * 데모 급여계약입니다. 월급 340만 원이라 데모 급여대장의 기본급이 HR이 없을 때의 기본값(300만 원)과 다르게 보입니다.
 *
 * 계좌번호 암호문은 결정적인 가짜 암호화(`PersonalDataCipher.layerFake`)로 `110123456789`를 감싼 값입니다.
 */
export const DEMO_PAYROLL_CONTRACTS: ReadonlyArray<PayrollContractRecord> = [
  {
    id: 'pct_01JBQ00000000000000000D3M1' as Id<'payrollContract'>,
    companyId: DEMO_COMPANY_ID,
    employeeId: 'emp_01JBQ00000000000000000D3M1' as Id<'employee'>,
    ...demoPayrollTerms,
    account: {
      bankCode: '004',
      accountNumberEncrypted: 'enc:MTEwMTIzNDU2Nzg5',
      accountNumberMasked: '********6789',
      accountHolder: '김세무',
    },
    derived: demoPayrollEvaluation.derived,
    warnings: demoPayrollEvaluation.warnings,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  },
]

/** 데모 소득세 공제 설정입니다. 본인 포함 공제대상 가족 3명, 그중 8–20세 자녀 1명입니다. */
export const DEMO_TAX_WITHHOLDING: ReadonlyArray<TaxWithholdingRecord> = [
  {
    id: 'emp_01JBQ00000000000000000D3M1' as Id<'employee'>,
    companyId: DEMO_COMPANY_ID,
    entries: [
      {
        effectiveFrom: '2025-03-02',
        dependantsCount: 3,
        childrenAged8To20Count: 1,
        calcMethod: 'TAX_TABLE',
        adjustmentRatePpm: 1_000_000,
      },
    ],
    version: 1,
    updatedAt: createdAt,
  },
]
