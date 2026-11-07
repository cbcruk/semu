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

/** 급여대장 행의 소득 구분입니다. */
export type PayrollIncomeType = 'WAGE_MONTHLY' | 'WAGE_HOURLY' | 'WAGE_DAILY' | 'DAILY' | 'BUSINESS' | 'OTHER'

/** 급여대장 상태입니다. */
export type PayrollLedgerStatus = 'DRAFT' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'CLOSED'

/** `GET /v1/payroll-ledgers/{id}` 응답입니다. 행은 따로 읽습니다. */
export interface PayrollLedger {
  id: string
  kind: 'REGULAR' | 'ADDITIONAL'
  workflow: 'CLIENT_APPROVAL' | 'DIRECT_CLOSE'
  status: PayrollLedgerStatus
  step: 1 | 2 | 3
  title: string
  attributionMonth: string
  paymentDate: string
  paymentMonth: string
  wagePeriod: { start: string; end: string }
  rowCount: number
  totals: {
    grossPay: number
    deductionTotal: number
    netPay: number
    incomeTax: number
    localIncomeTax: number
    employerInsurance: number
  }
  rejection: { reason: string; rejectedAt: string } | null
  reopenReason: string | null
  withholdingFiled: boolean
  allowedActions: string[]
  warnings: Array<{ code: string; message: string; rowId?: string }>
  calculatedAt: string | null
  closedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

/** 급여대장 행 입력입니다. `incomeType`마다 쓰는 필드가 다릅니다. 금액은 원, 시간은 분입니다. */
export interface PayrollRowInput {
  incomeType: PayrollIncomeType
  basePay?: number
  hourlyWage?: number
  dailyWage?: number
  workedDays?: number
  weeklyHolidayWeeks?: number
  proration?: { method: 'CALENDAR_DAYS' | 'SCHEDULED_DAYS'; payableDays: number; totalDays: number }
  paymentItems?: Array<{ code: string; name: string; amount: number }>
  otherDeductions?: Array<{ code: string; name: string; amount: number }>
  work?: {
    regularMinutes?: number
    overtimeMinutes?: number
    nightMinutes?: number
    holidayMinutes?: number
    holidayOvertimeMinutes?: number
    absenceMinutes?: number
    weeklyHolidayDeductionDays?: number
  }
  insuranceNotice?: {
    nationalPension?: number
    healthInsurance?: number
    longTermCare?: number
    employmentInsurance?: number
  }
  payAmount?: number
  workDays?: number
  averageDailyMinutes?: number
  employmentInsuranceExempt?: boolean
  businessIncomeCode?: string
  employmentInsuranceApplicable?: boolean
  otherIncomeCode?: string
  necessaryExpenseAmount?: number
  taxDeductionMode?: 'BEFORE_TAX' | 'AFTER_TAX'
}

interface Premiums {
  nationalPension: number
  healthInsurance: number
  longTermCare: number
  employmentInsurance: number
  industrialAccident: number
  total: number
}

/** 급여대장 행 계산 결과입니다. */
export interface PayrollRowResult {
  rateTable: string
  withholdingRateTable: string
  payments: Array<{
    code: string
    name: string
    amount: number
    taxableAmount: number
    nonTaxableAmount: number
    formula: string
  }>
  grossPay: number
  taxablePay: number
  nonTaxablePay: number
  employeeInsurance: Premiums
  employerInsurance: Premiums
  incomeTax: number
  localIncomeTax: number
  deductions: Array<{ code: string; name: string; amount: number; formula: string }>
  deductionTotal: number
  netPay: number
  breakdown: Array<{ code: string; label: string; amount: number; formula: string }>
  warnings: Array<{ code: string; message: string }>
}

/** `GET /v1/payroll-ledgers/{id}/rows`의 행입니다. */
export interface PayrollRow {
  id: string
  ledgerId: string
  employeeId: string | null
  payeeName: string
  incomeType: PayrollIncomeType
  input: PayrollRowInput
  result: PayrollRowResult | null
  updatedAt: string
}

/** `GET /v1/severance-settlements` 항목입니다. 원천세 요약(A21)이 쓰는 필드만 적습니다. */
export interface SeveranceSettlement {
  id: string
  employeeId: string
  employeeName: string
  lastWorkDate: string
  /** 퇴직금 지급일입니다. 정하지 않았거나 이 필드 전에 저장한 정산이면 `null`입니다. */
  paymentDate: string | null
  status: 'CALCULATED' | 'COMPLETED' | 'EXCLUDED'
  result: {
    eligible: boolean
    severancePay: number
    retirementIncomeTax: number
    localIncomeTax: number
    netPay: number
  }
}

/** 명세서 발송 결과 상태입니다. 보낸 적 없으면 `NOT_SENT`입니다. */
export type PayslipDeliveryStatus = 'NOT_SENT' | 'SENT' | 'FAILED'

/** 명세서 발송 실패 사유입니다. */
export type PayslipFailureReason = 'NO_EMAIL' | 'REJECTED'

/** `GET /v1/payslips`의 명세서입니다. 마감된 대장의 행 하나이고, 발송 기록은 마지막 한 번만 보입니다. */
export interface Payslip {
  id: string
  ledgerId: string
  rowId: string
  employeeId: string | null
  payeeName: string
  incomeType: string
  attributionMonth: string
  paymentDate: string
  payments: Array<{ code: string; name: string; amount: number }>
  deductions: Array<{ code: string; name: string; amount: number }>
  grossPay: number
  deductionTotal: number
  netPay: number
  delivery: {
    status: PayslipDeliveryStatus
    failureReason: PayslipFailureReason | null
    attemptedAt: string | null
    attempts: number
  }
}

/** `POST /v1/payslips:send`의 작업입니다(202). 메일 연동이 동기라 응답할 때 이미 끝나 있습니다. */
export interface PayslipSendJob {
  id: string
  status: 'SUCCEEDED' | 'PARTIALLY_SUCCEEDED' | 'FAILED'
  result: {
    items: Array<{ payslipId: string; status: 'SENT' | 'FAILED'; failureReason: PayslipFailureReason | null }>
  }
  createdAt: string
  finishedAt: string
}

/** 신고 건 상태입니다. */
export type FilingStatus =
  | 'SCHEDULED'
  | 'REQUESTED'
  | 'SUBMITTED'
  | 'REVIEWING'
  | 'LEDGER_PENDING'
  | 'PREPARING'
  | 'FILED'
  | 'SETTLED'
  | 'CANCELED'

/** `GET /v1/filings`의 신고 건입니다. `isOverdue`·`progress`는 새 API가 계산합니다. */
export interface FilingSummary {
  id: string
  taxType: 'VAT' | 'WITHHOLDING_TAX' | 'CORPORATE_TAX' | 'INCOME_TAX'
  kind: 'PRELIMINARY' | 'FINAL' | 'NOTICE' | 'MONTHLY' | 'SEMIANNUAL' | 'INTERIM' | 'ANNUAL'
  periodKey: string
  revision: number
  periodStart: string
  periodEnd: string
  statutoryDue: string | null
  dueDate: string | null
  paymentDue: string | null
  submitDue: string | null
  status: FilingStatus
  isOverdue: boolean
  progress: { stage: string | null; index: number; count: number }
  payableAmount: number | null
  settlement: 'PAID' | 'REFUND' | 'NO_PAYMENT' | null
  paidOn: string | null
  ledgerUploadedAt: string | null
  ledgerConfirmedAt: string | null
  ledgerDisputeCount: number
  paymentSlipSentAt: string | null
  version: number
  updatedAt: string
}

/** `GET /v1/filings/{id}`의 신고 건입니다. 고객에게는 지금 볼 수 있는 문서만 옵니다. */
export interface Filing extends FilingSummary {
  requirements: Array<{
    code: string
    response: 'PENDING' | 'PROVIDED' | 'NOT_APPLICABLE'
    autoLinked: boolean
    note: string | null
    fileIds: string[]
    updatedAt: string | null
  }>
  documents: Array<{
    id: string
    type: 'LEDGER' | 'RETURN' | 'PAYMENT_SLIP' | 'NOTICE'
    fileId: string
    createdAt: string
    firstViewedAt: string | null
    replacedAt: string | null
  }>
  allowedActions: string[]
}

/** `GET /v1/filings/{id}/history`의 이력 한 줄입니다. */
export interface FilingHistoryEntry {
  type: string
  actorKind: 'CLIENT' | 'AGENCY' | 'SYSTEM'
  /** 대리인이 고객 대신 한 일이면 `CLIENT`입니다. 그 밖에는 키가 없습니다. */
  onBehalfOf?: 'CLIENT'
  fromStatus: FilingStatus | null
  toStatus: FilingStatus | null
  detail: Record<string, string | number>
  occurredAt: string
}
