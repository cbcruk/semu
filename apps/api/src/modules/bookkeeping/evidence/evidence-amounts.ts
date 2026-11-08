import type { EvidenceRecord } from './evidence.types.ts'

/** 공급가액·세액·합계입니다. */
export interface EvidenceAmounts {
  supplyAmount: number
  vatAmount: number
  totalAmount: number
  /** 세액을 원천에서 받지 못해 합계에서 나눠 낸 값인지입니다. */
  vatEstimated: boolean
}

/**
 * 부가세 포함 합계에서 세액을 나눕니다. `합계 − ⌊합계 × 10 / 11⌋`이고 음수(취소)는 부호를 지킵니다.
 *
 * 예상 부가세와 같은 규칙입니다 (`apps/api/legacy/src/lib/money.ts`의 `splitVatFromTotal`).
 */
export function splitVatFromTotal(total: number): number {
  const 합계절댓값 = Math.abs(total)
  const 세액 = 합계절댓값 - Math.floor((합계절댓값 * 10) / 11)
  return total < 0 ? -세액 : 세액
}

/**
 * 증빙의 공급가액·세액·합계를 채웁니다.
 *
 * - 합계가 있으면(매출): 세액이 없으면 공급가액으로 `합계 − 공급가액`, 공급가액도 없으면 합계에서 나눕니다(카드 매출).
 *   공급가액이 없으면 `합계 − 세액`입니다
 * - 합계가 없으면(매입): 빠진 공급가액·세액을 0으로 보고 합계 = 공급가액 + 세액입니다
 */
export function evidenceAmounts(
  record: Pick<EvidenceRecord, 'totalAmount' | 'supplyAmount' | 'vatAmount'>,
): EvidenceAmounts {
  const { totalAmount, supplyAmount, vatAmount } = record
  if (totalAmount !== null) {
    const 세액 = vatAmount ?? (supplyAmount === null ? splitVatFromTotal(totalAmount) : totalAmount - supplyAmount)
    return {
      supplyAmount: supplyAmount ?? totalAmount - 세액,
      vatAmount: 세액,
      totalAmount,
      vatEstimated: vatAmount === null && supplyAmount === null,
    }
  }
  const 공급가액 = supplyAmount ?? 0
  const 세액 = vatAmount ?? 0
  return { supplyAmount: 공급가액, vatAmount: 세액, totalAmount: 공급가액 + 세액, vatEstimated: false }
}
