import type { Id } from '../../shared/ids/ids.types.ts'
import type { PayrollEmployee } from './ports/payroll-employee-directory.ts'

/** 데모 회사입니다. 로컬 개발의 기본 테스트 행위자 회사와 같은 값입니다. */
export const PAYROLL_DEMO_COMPANY_ID = 'cmp_01JBQ000000000000000000001' as Id<'company'>

const base = {
  registrationNumberMasked: '900101-1******',
  departmentName: '경영지원',
  leaveDate: null,
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
} as const

/** 로컬 개발용 데모 직원입니다. HR 포트 가짜가 씁니다. */
export const PAYROLL_DEMO_EMPLOYEES: ReadonlyArray<{ companyId: Id<'company'>; employee: PayrollEmployee }> = [
  {
    companyId: PAYROLL_DEMO_COMPANY_ID,
    employee: {
      ...base,
      id: 'emp_01JBQ000000000000000000001' as Id<'employee'>,
      name: '김하나',
      email: 'hana@example.com',
      joinDate: '2024-03-01',
      paymentUnit: 'MONTHLY',
      basePay: 3_000_000,
    },
  },
  {
    companyId: PAYROLL_DEMO_COMPANY_ID,
    employee: {
      ...base,
      id: 'emp_01JBQ000000000000000000002' as Id<'employee'>,
      name: '이둘',
      email: null,
      joinDate: '2025-07-01',
      paymentUnit: 'HOURLY',
      basePay: 0,
      hourlyWage: 12_000,
    },
  },
]
