/** 기간이 있는 급여 참조 코드(사업소득 업종코드·기타소득 지급사유)입니다. */
export interface ReferenceCode {
  code: string
  name: string
  /** 기타소득 의제 필요경비율(ppm)입니다. `null`이면 실제 경비만 받거나 해당 없음입니다. */
  expenseRatePpm: number | null
  /** 기타소득 세율(ppm)입니다. 사업소득 업종은 `null`입니다. */
  taxRatePpm: number | null
  /** 사업소득 업종의 고용보험 구분입니다. 예술인(`ARTIST`), 노무제공자(`SPECIAL`)입니다. */
  detailType: 'ARTIST' | 'SPECIAL' | null
  effectiveFrom: string
  effectiveTo: string | null
  /** 스펙으로 확인한 값인지입니다. */
  verified: boolean
}
