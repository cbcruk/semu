import type { Id } from '../../shared/ids/ids.types.ts'

/** 회사가 구독하는 유료 플랜입니다. 현행 `tax_plan`, `has_payroll_plan`을 대신합니다. */
export type Plan = 'TAXATION' | 'PAYROLL'

/** 회사의 사업자 형태입니다. 신고 종류와 메뉴가 갈립니다. */
export type BusinessType = 'CORPORATION' | 'INDIVIDUAL'

/**
 * 행위자 종류입니다.
 *
 * - `CLIENT`: 회사 소속 사용자
 * - `AGENCY`: 그 회사에 배정된 세무 대리인 직원(팀장은 팀원 배정 포함)
 */
export type ActorKind = 'CLIENT' | 'AGENCY'

/**
 * `resource:action` 형식의 권한입니다. 예: `employee:read`, `payroll-ledger:approve`.
 *
 * `resource:*`는 그 리소스의 모든 동작, `*`는 모든 권한입니다. 다만 와일드카드는 대리인 전용 동작(`filing:process` 등)을
 * 덮지 않습니다. 세무 대리인은 `*` 대신 카탈로그의 대리인 기본 권한(`AGENT_PERMISSIONS`)을 받습니다(D5).
 */
export type Permission = `${string}:${string}` | '*'

/**
 * 인증을 마친 요청의 행위자입니다. 액세스 토큰 하나는 회사 하나에 묶이고, 회사를 바꾸려면 토큰을 새로 받습니다.
 *
 * 모든 회사 리소스는 `companyId`로 범위를 정하므로 경로에 회사 ID를 넣지 않습니다.
 */
export interface Actor {
  userId: Id<'user'>
  companyId: Id<'company'>
  kind: ActorKind
  /** 역할 프리셋과 개별 부여를 합쳐 계산한 권한 집합입니다. */
  permissions: ReadonlySet<Permission>
  plans: ReadonlySet<Plan>
  businessType: BusinessType
  /** 아직 동의하지 않은 필수 약관 코드입니다. 비어 있지 않으면 해당 제품 API가 403입니다. */
  pendingTermCodes: ReadonlyArray<string>
  /** 데모 계정은 읽기만 합니다. */
  isDemo: boolean
}

/**
 * 액세스 토큰의 범위입니다.
 *
 * - `COMPANY`: 회사 하나에 묶인 토큰. `/agency/*`를 뺀 모든 리소스가 받습니다
 * - `AGENCY`: 세무 대리인이 담당 회사 전체를 가로질러 보는 토큰. `/agency/*`만 받습니다
 */
export type TokenScope = 'COMPANY' | 'AGENCY'

/** 세무 대리인 사용자 종류입니다. 팀장은 팀원에게 배정된 회사도 봅니다. */
export type AgentKind = 'AGENCY_STAFF' | 'AGENCY_MANAGER'

/**
 * 대리인 범위 토큰이 가리키는 사용자입니다. 담당 회사는 토큰에 넣지 않고 요청마다 배정에서 다시 읽습니다.
 *
 * 그래서 배정을 풀면 토큰을 폐기하지 않아도 다음 요청부터 그 회사가 보이지 않습니다.
 */
export interface AgencyPrincipal {
  scope: 'AGENCY'
  userId: Id<'user'>
  userKind: AgentKind
}

/** 대리인이 담당하는 회사 하나입니다. 요청마다 배정·회사·구독에서 계산합니다. */
export interface AgentCompany {
  companyId: Id<'company'>
  name: string
  businessType: BusinessType
  plans: ReadonlySet<Plan>
  /** 이 회사에 배정된 담당자입니다. 팀장에게는 팀원 ID가 들어 있습니다. */
  assigneeIds: ReadonlyArray<Id<'user'>>
}

/**
 * 대리인 범위 요청의 행위자입니다. {@link AgencyPrincipal}에 지금 담당 회사와 권한을 붙인 값입니다.
 *
 * 회사 리소스의 {@link Actor}와 달리 회사 하나에 묶이지 않습니다. 회사 리소스를 바꾸려면 회사 토큰으로 전환합니다.
 */
export interface Agent {
  userId: Id<'user'>
  userKind: AgentKind
  /** 대리인 권한입니다. 회사 범위의 대리인 행위자와 같은 `AGENT_PERMISSIONS`입니다(D5). */
  permissions: ReadonlySet<Permission>
  /** 이름 순 담당 회사입니다. */
  companies: ReadonlyArray<AgentCompany>
}
