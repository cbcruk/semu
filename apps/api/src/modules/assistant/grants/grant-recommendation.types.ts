/** 추천 판정에 쓰는 공고의 부분입니다. */
export interface GrantWindow {
  id: string
  /** 신청 시작일 `YYYY-MM-DD`입니다. */
  applyStartOn: string
  /** 신청 마감일입니다. `null`이면 상시 모집입니다. */
  applyEndOn: string | null
  /** 대상 업종 코드(한국표준산업분류)입니다. 비어 있으면 업종 제한이 없습니다. */
  industryCodes: ReadonlyArray<string>
  /** 대상 지역 코드(법정동 시·도 또는 시·군·구)입니다. 비어 있으면 전국입니다. */
  regionCodes: ReadonlyArray<string>
}

/** 추천에 쓰는 회사 정보입니다. */
export interface GrantProfile {
  /** 회사 업종 코드입니다. 비어 있으면 업종이 불명확한 것으로 보고 업종으로 거르지 않습니다. */
  industryCodes: ReadonlyArray<string>
  /** 회사 지역 코드입니다. 없으면 전국 공고만 맞습니다. */
  regionCode: string | null
}
