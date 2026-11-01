import type { YearMonth } from '../engine/rate-table.types'

/** A reference code valid over a range of months. */
export interface ReferenceCode {
  code: string
  name: string
  effectiveFrom: YearMonth
  /** Last month the code is valid, or `null` while it is current. */
  effectiveTo: YearMonth | null
  /** `true` only when the code is confirmed by the spec or a product screen. */
  verified: boolean
}

/** A 사업소득 업종코드 from the 간이지급명세서 code list. */
export interface BusinessIncomeType extends ReferenceCode {
  /** `artist` (예술인) or `special` (특고·노무제공자) types carry extra columns and employment insurance. */
  detailType: 'artist' | 'special' | null
}

/** A 기타소득 지급사유 with its necessary expense rule and tax rate. */
export interface OtherIncomeType extends ReferenceCode {
  /** Deemed necessary expense rate in ppm; `null` when actual expenses are entered. */
  expenseRatePpm: number | null
  taxRatePpm: number
}

/** A country code for foreign workers' residence country. */
export interface NationCode {
  code: string
  name: string
}
