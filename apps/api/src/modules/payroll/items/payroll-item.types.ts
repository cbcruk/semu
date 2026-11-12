import type { Id } from '../../../shared/ids/ids.types.ts'
import type { NonTaxableCategory } from '../engine/rate-table.types.ts'

/** 지급 항목이 엔진 계산에 넘기는 속성입니다. */
export interface PaymentItemAttributes {
  /** 통상임금(가산수당·근태공제 단가)에 넣는지입니다. 월급제에만 쓰입니다. */
  includeInOrdinaryWage: boolean
  /** 최저임금 비교 시급에 넣는지입니다. 월급제에만 쓰입니다. */
  includeInMinimumWage: boolean
  /** 중도 입·퇴사 때 기본급과 함께 일할계산하는지입니다. 월급제에만 쓰입니다. */
  prorate: boolean
}

/** 표준 지급 항목 하나입니다. 코드에 둔 참조 데이터입니다. */
export interface PaymentItemCategory extends PaymentItemAttributes {
  code: string
  name: string
  /** 법정 비과세 유형입니다. 과세 항목은 `null`입니다. */
  nonTaxableCategory: NonTaxableCategory | null
  description: string
}

/**
 * 회사의 지급 항목입니다. 표준 항목을 불러온 것(`categoryCode`)이거나 회사가 직접 만든 과세 항목입니다.
 *
 * 4대보험 보수에 넣는지는 따로 두지 않습니다. 보수는 비과세를 뺀 과세 급여라 비과세 유형과 한도가 정합니다.
 */
export interface PaymentItemRecord extends PaymentItemAttributes {
  id: Id<'paymentItem'>
  companyId: Id<'company'>
  /** 불러온 표준 항목 코드입니다. 직접 만든 항목은 `null`입니다. */
  categoryCode: string | null
  name: string
  /** 표준 항목에서 옵니다. 직접 만든 항목은 늘 `null`(과세)입니다. */
  nonTaxableCategory: NonTaxableCategory | null
  /** 회사가 정한 비과세 한도(월)입니다. 법정 한도와 작은 쪽을 씁니다. 비과세 항목에만 있습니다. */
  companyNonTaxableLimit: number | null
  /** 전 직원에게 같은 금액을 줄 때의 금액입니다. 정기 대장을 만들 때 근로 행에 넣습니다. */
  defaultAmount: number | null
  /** 지운 때입니다. 지운 항목은 목록과 새 입력에서 빠지고, 이미 넣은 행의 계산에는 남습니다. */
  archivedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

/** 공제 금액을 정하는 방법입니다. 매달 같은 금액(`FIXED`) 또는 대장에서 행마다 입력(`ON_SETTLEMENT`)입니다. */
export type DeductionAmountMode = 'FIXED' | 'ON_SETTLEMENT'

/** 회사의 공제 항목입니다. 선지급금(가불), 사내 동호회비처럼 4대보험·세금 밖의 공제입니다. */
export interface DeductionItemRecord {
  id: Id<'deductionItem'>
  companyId: Id<'company'>
  name: string
  amountMode: DeductionAmountMode
  /** `FIXED`의 금액입니다. 정기 대장을 만들 때 근로 행에 넣습니다. `ON_SETTLEMENT`는 `null`입니다. */
  amount: number | null
  archivedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

/** 행 계산에 쓰는 회사 카탈로그입니다. 지운 항목도 들어 있습니다. */
export interface PayrollItemCatalog {
  paymentItems: ReadonlyMap<string, PaymentItemRecord>
  deductionItems: ReadonlyMap<string, DeductionItemRecord>
}

/** 항목 입력 규칙 위반 하나입니다. */
export interface PayrollItemViolation {
  field: string
  code: string
}
