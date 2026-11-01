/** Registration status of a business at the National Tax Service. */
export interface BusinessStatus {
  businessStatus: 'registered' | 'suspended' | 'closed' | 'unknown'
  /** Taxation type label such as `부가가치세 일반과세자`, or `null` when unknown. */
  taxationType: string | null
  closedOn: string | null
}

/** National Tax Service business status lookup (공공데이터 사업자 상태조회). */
export interface BusinessStatusAdapter {
  /** Looks up a 10-digit business number without hyphens. */
  lookup(businessNumber: string): Promise<BusinessStatus>
}
