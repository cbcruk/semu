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
  resignation?: { leaveDate: string; leavingReasonCode: string; leavingDetailReasonCode?: string }
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
