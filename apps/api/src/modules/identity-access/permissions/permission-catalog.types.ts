import type { Plan } from '../actor.types.ts'

/** 권한 카탈로그를 화면 묶음으로 나누는 영역입니다. 현행 메뉴 2뎁스 그룹에 대응합니다. */
export type PermissionArea =
  'SETTINGS' | 'BILLING' | 'INTEGRATIONS' | 'ASSISTANT' | 'HR' | 'DOCUMENTS' | 'PAYROLL' | 'BOOKKEEPING' | 'TAX'

/** 리소스 하나의 권한 정의입니다. */
export interface ResourcePermissions {
  area: PermissionArea
  /** 이 리소스에 쓸 수 있는 동작입니다. */
  actions: ReadonlyArray<string>
  /** 관리자만 가질 수 있어 권한 그룹으로 줄 수 없는 동작입니다. 사용자 초대·권한 관리가 여기에 듭니다. */
  adminOnly?: ReadonlyArray<string>
  /**
   * 세무 대리인만 갖는 동작입니다(D5). 권한 그룹에 넣을 수 없고, `*`·`resource:*` 와일드카드도 덮지 않습니다.
   * 대리인 기본 권한(`AGENT_PERMISSIONS`)이 이 동작을 하나씩 적어 줍니다.
   */
  agentOnly?: ReadonlyArray<string>
  /** 이 리소스를 쓰는 데 필요한 플랜입니다. 하나라도 있으면 됩니다. 엔드포인트의 `authorize({ plans })`와 같아야 합니다. */
  plans?: ReadonlyArray<Plan>
}

/** 권한 그룹 템플릿입니다. 현행 `GET /api/perm/roles`의 시스템 기본 권한 그룹(`경리 (무료)`, `인사` …)을 대신합니다. */
export interface RoleTemplate {
  code: 'BOOKKEEPING' | 'HR' | 'PAYROLL' | 'TAX' | 'SETTINGS'
  name: string
  permissions: ReadonlyArray<string>
}

/** 현행 메뉴 코드 하나가 재설계에서 대응하는 권한과 플랜입니다. */
export interface LegacyMenuMapping {
  /** 이 메뉴를 권한 그룹에 넣었을 때 주는 권한입니다. 비어 있으면 모든 구성원의 기본 권한으로 덮입니다. */
  permissions: ReadonlyArray<string>
  plans: ReadonlyArray<Plan>
  /** 현행 `requiresPermission: false`처럼 권한 그룹 없이 모두에게 열린 메뉴인지입니다. */
  openToEveryone: boolean
}
