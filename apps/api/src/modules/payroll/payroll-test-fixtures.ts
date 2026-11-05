import type { Id } from '../../shared/ids/ids.types.ts'
import type { PayrollEmployee } from './ports/payroll-employee-directory.ts'
import { defaultPayrollSetting } from './settings/payroll-setting.ts'
import type { PayrollSettingRecord } from './settings/payroll-setting.types.ts'

/** 테스트 직원을 만듭니다. 기본은 2024년 1월 입사, 월급 300만원, 퇴직금 제도인 재직자입니다. */
export function testEmployee(overrides: Partial<PayrollEmployee> = {}): PayrollEmployee {
  return {
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
    incomeTax: { dependants: 1, childrenAged8To20: 0, withholdingRatePpm: 1_000_000, manualAmount: null },
    retirementBenefitType: 'SEVERANCE_PAY',
    ...overrides,
  }
}

/** 4대보험을 모두 요율로 계산하는 직접 마감 설정입니다. 스펙 검증값과 맞추려고 씁니다. */
export function rateBasedSetting(overrides: Partial<PayrollSettingRecord> = {}): PayrollSettingRecord {
  return {
    ...defaultPayrollSetting(),
    deductionMethods: {
      nationalPension: 'RATE',
      healthInsurance: 'RATE',
      employmentInsurance: 'RATE',
      incomeTax: 'TAX_TABLE',
    },
    ...overrides,
  }
}
