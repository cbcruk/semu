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
 * `resource:*`는 그 리소스의 모든 동작, `*`는 모든 권한입니다. 세무 대리인은 `*`를 받습니다.
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
