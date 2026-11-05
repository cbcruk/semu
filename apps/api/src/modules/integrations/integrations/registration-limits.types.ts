import type { AuthMethod, InstitutionType } from '../institutions/institution.ts'

/** 등록 규칙이 보는 새 연동 요청입니다. 자격 증명 원문은 들어오지 않습니다. */
export interface RegistrationRequest {
  type: InstitutionType
  authMethod: AuthMethod
  /** 카드사·은행·PG사·배달앱 코드입니다. 카드·은행은 인증서로 여러 기관을 한 번에 고를 수 있습니다. */
  institutionCodes: ReadonlyArray<string>
  isCorporate: boolean
  /** PG 상점아이디입니다. */
  mid?: string
  /** PG 연동키 이름 목록입니다. 값이 빈 키는 넣지 않습니다. */
  keyNames?: ReadonlyArray<string>
  /** 새로 등록할 항목(카드·계좌·매장) 수입니다. 이미 등록한 항목은 빼고 셉니다. */
  newItemCount: number
  /** 빠른조회 계정·배달앱 계정 같은 로그인 ID입니다. 같은 계정 중복을 막는 데 씁니다. */
  accountId?: string
}

/** 이미 있는 연동 하나입니다. */
export interface ExistingIntegration {
  type: InstitutionType
  authMethod: AuthMethod
  institutionCode?: string
  /** PG면 MID, 그 밖에는 로그인 ID입니다. */
  accountKey?: string
}

/** 회사가 이미 가진 연동과 항목 수입니다. */
export interface ExistingLinks {
  integrations: ReadonlyArray<ExistingIntegration>
  /** 같은 유형의 활성 항목 수입니다. */
  itemCount: number
}

/**
 * 등록을 거절한 이유입니다.
 *
 * - `AUTH_METHOD_NOT_SUPPORTED`: 그 기관이 받지 않는 인증 방법(지로 ID/PW, 배달 인증서, 하나·롯데·삼성 법인카드 인증서)
 * - `SINGLE_INSTITUTION_REQUIRED`: ID/PW 연동은 기관 하나씩입니다
 * - `ITEM_LIMIT_EXCEEDED`: 유형별 20개 한도
 * - `NO_NEW_ITEMS`: 고른 항목이 모두 이미 등록됐습니다
 * - `INTEGRATION_DUPLICATE`: 같은 연동이 이미 있습니다
 * - `PG_*`: PG사·MID·연동키 오류
 */
export type RegistrationViolation =
  | { code: 'AUTH_METHOD_NOT_SUPPORTED'; field: string }
  | { code: 'SINGLE_INSTITUTION_REQUIRED'; field: 'institutionCodes' }
  | { code: 'ITEM_LIMIT_EXCEEDED'; field: string; limit: number }
  | { code: 'NO_NEW_ITEMS'; field: 'itemKeys' }
  | { code: 'INTEGRATION_DUPLICATE' }
  | { code: 'PG_COMPANY_UNKNOWN'; field: 'institutionCodes' }
  | { code: 'PG_MID_NOT_SUPPORTED'; field: 'mid' }
  | { code: 'PG_KEY_MISSING'; field: string; missing: ReadonlyArray<string> }

/** 등록해도 되는 요청에 서버가 덧붙이는 사실입니다. */
export interface RegistrationAccepted {
  ok: true
  /** 홈택스 인증서 연동만 세금계산서를 발급할 수 있습니다. */
  canIssueTaxInvoice: boolean
  /** 세무사 프로그램으로 넘길 수 있는 연동인지입니다. 인증서 연동은 세무신고에 못 씁니다. */
  usableForTaxFiling: boolean
  /** PG 쪽에 미리 등록해야 하는 대사 IP입니다. */
  ipWhitelist?: string
}

/** 등록 판정 결과입니다. */
export type RegistrationDecision = RegistrationAccepted | { ok: false; violation: RegistrationViolation }
