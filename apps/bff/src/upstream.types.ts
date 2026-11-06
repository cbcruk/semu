/**
 * BFF가 읽는 새 API(`/v1`) 응답의 모양입니다. BFF는 새 API 코드를 가져오지 않고 와이어 계약만 따르므로,
 * 쓰는 필드만 여기 다시 적습니다. 원본은 `apps/api/src/modules/*`의 스키마입니다.
 */

export type Plan = 'TAXATION' | 'PAYROLL'

export interface UserProfile {
  id: string
  email: string
  name: string
  kind: 'CLIENT' | 'AGENCY_STAFF' | 'AGENCY_MANAGER'
  isDemo: boolean
}

export interface CompanySummary {
  id: string
  name: string
  businessType: 'CORPORATION' | 'INDIVIDUAL'
  actorKind: 'CLIENT' | 'AGENCY'
}

/** `POST /v1/auth/sessions`, `:refresh`, `:switch-company` 응답입니다. */
export interface SessionGrant {
  accessToken?: string
  expiresIn?: number
  onboardingToken?: string
  user: UserProfile
  company?: CompanySummary & { plans: Plan[] }
  companies: CompanySummary[]
}

/** `GET /v1/me` 응답입니다. */
export interface Me {
  user: UserProfile
  company: CompanySummary & { plans: Plan[] }
  membership?: { access: 'ADMIN' | 'MEMBER'; roleIds: string[]; isOwner: boolean }
  permissions: string[]
  pendingTermCodes: string[]
  companies: CompanySummary[]
}

/** `GET /v1/companies/current` 응답입니다. */
export interface Company {
  id: string
  name: string
  businessNumber: string
  businessType: 'CORPORATION' | 'INDIVIDUAL'
  phone?: string
  industry?: string
  address?: { zipCode: string; line1: string; line2?: string }
  regionCode?: string
  corporateRegistrationNumber?: string
  establishedOn?: string
  representatives: Array<{ name: string; phone?: string }>
  agency?: { id: string; name: string; kind: 'HQ' | 'BRANCH' }
  createdAt: string
  version: number
}

/** 직원의 퇴사 정보입니다. `:resign`으로 정합니다. */
export interface Resignation {
  leaveDate: string
  leavingReasonCode: string
  leavingDetailReasonCode?: string
}

export type EmployeeStatus = 'PRE_JOINED' | 'JOINED' | 'LEAVE' | 'RESIGNED'

/** `GET /v1/employees`, `GET /v1/employees/{id}`의 직원입니다. */
export interface Employee {
  id: string
  kind: 'WAGE' | 'DAILY' | 'BUSINESS' | 'OTHER'
  name: string
  identityType?: 'RRN' | 'PASSPORT'
  registrationNumberMasked?: string
  birthDate?: string
  joinDate: string
  isRejoin: boolean
  departmentId?: string
  positionId?: string
  email?: string
  phone?: string
  isForeigner: boolean
  nationalityCode?: string
  visaCode?: string
  resignation?: Resignation
  severanceSettlementStatus?: 'IN_PROGRESS' | 'COMPLETED' | 'EXCLUDED'
  status: EmployeeStatus
  warnings: string[]
  version: number
  createdAt: string
  updatedAt: string
}

/** 커서 목록입니다. */
export interface Page<A> {
  items: A[]
  nextCursor?: string
  totalCount?: number
}

/** 부서·직위입니다. */
export interface OrganizationUnit {
  id: string
  name: string
  order: number
}

/** 근로계약·급여계약의 기준일 상태입니다. */
export type ContractStatus = 'SCHEDULED' | 'ACTIVE' | 'EXPIRED'

/** `GET /v1/employees/{id}/work-contracts`의 근로계약입니다. 수습 지급률은 ppm(`1_000_000` = 100%)입니다. */
export interface WorkContract {
  id: string
  employeeId: string
  contractType: 'PERMANENT' | 'FIXED_TERM'
  startDate: string
  endDate?: string
  weeklyWorkHours?: number
  probation?: { months?: number; payRatePpm?: number }
  standardOccupationCode?: string
  termLimitExemption?: string
  status: ContractStatus
  createdAt: string
}

/** `GET /v1/employees/{id}/indefinite-conversion` 응답입니다. */
export interface IndefiniteConversion {
  isTarget: boolean
  status: 'NONE' | 'APPROACHING' | 'EXCEEDED'
  isExempt: boolean
  exemptReason?: string
  chainStartDate?: string
  chainEndDate?: string
  totalContractDays: number
  conversionDate?: string
  daysUntilConversion?: number
}

/** 고정 연장·야간·휴일 수당 한 종류입니다. */
export interface FixedAllowance {
  enabled: boolean
  hours: number
  amount: number
}

/** 고정수당 종류입니다. */
export type FixedAllowanceKind = 'overtime' | 'night' | 'holiday' | 'holidayOvertime'

/** 급여계약 입력입니다. `POST`와 `PUT`이 같이 씁니다. */
export interface PayrollContractInput {
  startDate: string
  endDate?: string
  wageType: 'MONTHLY' | 'DAILY' | 'HOURLY'
  amount: number
  monthlyWorkHours: number
  monthlyWorkHoursSource?: 'POLICY' | 'MANUAL'
  dailyWorkHours?: number
  paymentItems?: Array<{
    paymentItemId: string
    amount: number
    enabled: boolean
    ordinaryWage?: boolean
    countsTowardMinimumWage?: boolean
  }>
  fixedAllowanceAutoCalc?: boolean
  fixedAllowances?: Partial<Record<FixedAllowanceKind, FixedAllowance>>
  bonus?: { amount: number; inOrdinaryWage: boolean }
  annualSalary?: number
  payTiming?: { month: 'CURRENT' | 'NEXT'; day: number }
  payMethod?: 'TRANSFER' | 'CASH'
  account?: { bankCode: string; accountNumber: string; accountHolder: string }
}

/** `GET /v1/payroll-contracts/{id}`의 급여계약입니다. 계좌번호는 끝 4자리만 담습니다. */
export interface PayrollContract extends Omit<PayrollContractInput, 'account'> {
  id: string
  employeeId: string
  account?: { bankCode: string; accountNumberMasked: string; accountHolder: string }
  derived: {
    baseSalary: number
    baseHourlyWage: number
    ordinaryHourlyWage: number
    probationHourlyWage?: number
    fixedAllowanceAmounts: Record<FixedAllowanceKind, number>
    minimumWageHourly: number
    statutoryMinimumHourlyWage: number
  }
  warnings: Array<'BELOW_MINIMUM_WAGE' | 'PROBATION_BELOW_MINIMUM_WAGE'>
  status: ContractStatus
  version: number
  createdAt: string
  updatedAt: string
}

/** 휴직 사유입니다. */
export type LeaveReason = 'MATERNITY' | 'PARENTAL' | 'ILLNESS' | 'OTHER'

/** `GET /v1/employees/{id}/leaves`의 휴직입니다. */
export interface Leave {
  id: string
  employeeId: string
  reason: LeaveReason
  startDate: string
  endDate: string
  expectedReturnDate: string
  actualReturnDate?: string
  paidAllowance?: number
  includeInServiceYears: boolean
  npsPaymentException: boolean
  nhisNoticeDeferral: boolean
  version: number
}

/** 휴직 등록 본문입니다. */
export interface CreateLeave {
  reason: LeaveReason
  startDate: string
  endDate: string
  expectedReturnDate?: string
  paid?: { allowance?: number }
  includeInServiceYears?: boolean
  npsPaymentException?: boolean
  nhisNoticeDeferral?: boolean
}

/** `GET /v1/employees/{id}/leaves`의 휴직 요약입니다. */
export interface LeaveSummary {
  isOnLeave: boolean
  currentLeaveId?: string
  upcomingLeaveId?: string
  totalLeaveDays: number
  parentalLeaveDays: number
  parentalLeaveRemainingDays: number
}
