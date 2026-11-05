/** 약관 용도입니다. 현행 `purpose_code`(`signup`, `tax`, `consulting`)를 대신합니다. 마케팅 수신 동의는 `SIGNUP`의 선택 약관입니다. */
export type TermPurpose = 'SIGNUP' | 'TAX' | 'CONSULTING'

/**
 * 사용자에게 약관 하나가 어떤 상태인지입니다.
 *
 * - `SETTLED`: 더 물을 것이 없음
 * - `REQUIRED`: 필수 약관인데 지금 버전에 동의하지 않음. 해당 제품 API가 403입니다
 * - `REVIEW`: 선택 약관의 새 버전이 나옴. 다시 묻지만 막지 않습니다
 */
export type ConsentStatus = 'SETTLED' | 'REQUIRED' | 'REVIEW'

/** 판정에 필요한 약관 필드입니다. */
export interface ConsentTerm {
  code: string
  version: string
  required: boolean
}

/** 판정에 필요한 마지막 동의 기록입니다. */
export interface ConsentHistory {
  version: string
  agreed: boolean
}
