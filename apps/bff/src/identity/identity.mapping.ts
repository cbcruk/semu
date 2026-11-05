import type { Company, Me, Plan, UserProfile } from '../upstream.types.ts'

/** 현행 `user_type` 정수입니다. */
const USER_TYPE = { CLIENT: 0, AGENCY_STAFF: 1, AGENCY_MANAGER: 2, DEMO: 99 } as const

/**
 * 현행 프로필(`GET /api/member/profile/`, 로그인 응답의 `user`)입니다.
 *
 * 새 API에 없는 `phone`, `marketing_agreed`, `last_login_at`은 `null`·`false`로 둡니다.
 */
export function toLegacyProfile(user: UserProfile): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: null,
    user_type: user.isDemo ? USER_TYPE.DEMO : USER_TYPE[user.kind],
    marketing_agreed: false,
    last_login_at: null,
  }
}

/** 현행 `tax_plan`입니다. 세무 기장 플랜이면 `taxation`, 아니면 `null`입니다. */
export function toLegacyTaxPlan(plans: readonly Plan[]): 'taxation' | null {
  return plans.includes('TAXATION') ? 'taxation' : null
}

/**
 * 현행 `GET /api/user/me/`입니다. 프로필에 전환할 수 있는 회사 요약을 붙입니다.
 *
 * 현행 회사 ID 두 개(`id`, `sf_company_id`)는 새 회사 ID 하나로 채웁니다.
 * 새 API의 회사 목록에는 플랜과 관리자 여부가 없으므로, 지금 회사만 `tax_plan`·`is_system_admin`을 채우고 나머지는 `null`·`false`입니다.
 */
export function toLegacyMe(me: Me): Record<string, unknown> {
  return {
    ...toLegacyProfile(me.user),
    companies: me.companies.map((company) => {
      const current = company.id === me.company.id
      return {
        id: company.id,
        sf_company_id: company.id,
        name: company.name,
        tax_plan: current ? toLegacyTaxPlan(me.company.plans) : null,
        is_system_admin: current && me.membership?.isOwner === true,
      }
    }),
  }
}

/** 회사가 없는 사용자의 `GET /api/user/me/`입니다. 새 API는 이 사용자에게 `/v1/me`를 열지 않습니다. */
export function toLegacyMeWithoutCompany(user: UserProfile): Record<string, unknown> {
  return { ...toLegacyProfile(user), companies: [] }
}

/**
 * 현행 회사 상세(`GET /api/company/:id/`, `GET /api/settings/company/:id/`)입니다.
 *
 * 급여 지급일(`payday_*`)은 Payroll 급여 설정으로, 법인 종류·투자형태는 아직 새 API에 없어 `null`입니다.
 */
export function toLegacyCompany(company: Company, plans: readonly Plan[]): Record<string, unknown> {
  const representatives = company.representatives.map((representative, index) => ({
    id: null,
    role: index === 0 ? 'boss' : 'representative',
    name: representative.name,
    phone: representative.phone ?? null,
  }))
  return {
    id: company.id,
    sf_company_id: company.id,
    nexus_company_id: company.id,
    name: company.name,
    business_number: company.businessNumber,
    kind: company.businessType === 'CORPORATION' ? 0 : 1,
    business_type: company.businessType === 'CORPORATION' ? 'corporate' : 'individual',
    tax_plan: toLegacyTaxPlan(plans),
    has_payroll_plan: plans.includes('PAYROLL'),
    phone: company.phone ?? null,
    business_category: company.industry ?? null,
    zip_code: company.address?.zipCode ?? null,
    address: company.address?.line1 ?? null,
    address_detail: company.address?.line2 ?? null,
    payday_month: null,
    payday_day: null,
    corporate_number: company.corporateRegistrationNumber ?? null,
    corp_investment_type: null,
    corp_type: null,
    established_on: company.establishedOn ?? null,
    region_code: company.regionCode ?? null,
    agency: company.agency === undefined ? null : { id: company.agency.id, type: company.agency.kind.toLowerCase() },
    representative_set: representatives,
    representatives,
    created_at: company.createdAt,
    updated_at: null,
  }
}
