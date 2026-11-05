import type { FilingKind, FilingStatus } from '../tax.types.ts'

/** 매출 증빙 출처입니다. */
export type SalesSource = 'TAX_INVOICE' | 'CASH_RECEIPT' | 'CARD' | 'PG' | 'MALL' | 'DELIVERY'

/** 매입 증빙 출처입니다. */
export type PurchaseSource = 'TAX_INVOICE' | 'CASH_RECEIPT' | 'CARD'

/** 예상 부가세를 계산하는 기간입니다. 법인은 분기, 개인은 반기입니다. */
export interface VatPeriod {
  start: string
  end: string
  unit: 'QUARTER' | 'HALF'
}

/** 매출 증빙 한 건입니다. Bookkeeping이 포트로 줍니다. */
export interface SalesEvidence {
  id: string
  source: SalesSource
  issuedOn: string
  /** 부가세를 포함한 합계입니다. 취소는 음수입니다. */
  totalAmount: number
  /** 원천 데이터에 있는 세액입니다. 카드처럼 없으면 `null`이고 합계에서 나눕니다. */
  vatAmount: number | null
  /** 같은 결제를 가리키는 증빙 묶음입니다. 묶음마다 한 건만 셉니다. */
  dedupeGroup: string | null
  syncedAt: string
}

/** 매입 증빙 한 건입니다. */
export interface PurchaseEvidence {
  id: string
  source: PurchaseSource
  issuedOn: string
  vatAmount: number
  /** 매입세액 공제 여부입니다. 아직 분류하지 않았으면 `null`입니다. */
  deductible: boolean | null
  syncedAt: string
}

/** 출처 하나의 세액과 수집 신선도입니다. */
export interface VatBreakdownEntry {
  side: 'SALES' | 'PURCHASE'
  source: SalesSource | PurchaseSource
  vatAmount: number
  /** 예상 세액 합계에 넣었는지입니다. 몰·배달은 PG와 겹칠 수 있어 넣지 않습니다. */
  includedInTotal: boolean
  lastSyncedAt: string | null
}

/** 예상 부가세입니다. `estimatedTax`가 음수면 환급 예상입니다. */
export interface VatEstimate {
  period: VatPeriod
  outputTax: number
  inputTax: number
  estimatedTax: number
  /** 합계에 넣은 매출 중 세액을 합계에서 나눠 추정한 건이 있는지입니다. */
  cardSplitEstimated: boolean
  breakdown: VatBreakdownEntry[]
  excluded: { nonDeductibleCount: number; unclassifiedCount: number }
}

/** {@link estimateVat}의 입력입니다. */
export interface VatEstimateInput {
  period: VatPeriod
  sales: ReadonlyArray<SalesEvidence>
  purchases: ReadonlyArray<PurchaseEvidence>
  /** 카드 매출 중 과세 매출 비율입니다. ppm(100% = 1,000,000)입니다. */
  taxableCardRatioPpm: number
}

/** 확정 세액을 정하는 데 쓰는 부가세 신고 건입니다. */
export interface VatFilingFact {
  kind: FilingKind
  status: FilingStatus
  periodStart: string
  periodEnd: string
  payableAmount: number | null
}

/** 부가세 추이의 과세기간 하나입니다. */
export interface VatTrendPoint {
  year: number
  half: 1 | 2
  amount: number
  /** `CONFIRMED`는 신고한 세액, `ESTIMATED`는 증빙으로 계산한 세액입니다. */
  source: 'CONFIRMED' | 'ESTIMATED'
}

/** {@link vatTrend}의 입력입니다. */
export interface VatTrendInput {
  /** 회사 시간대 오늘입니다. */
  today: string
  /** 올해를 포함해 몇 해를 보여 줄지입니다. */
  years: number
  /** 세무 기장(`TAXATION`) 고객인지입니다. 아니면 확정 세액을 쓰지 않습니다. */
  hasTaxationPlan: boolean
  filings: ReadonlyArray<VatFilingFact>
  /** 기간의 예상 세액을 계산합니다. */
  estimate: (period: VatPeriod) => number
}
