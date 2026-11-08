/** 거래처 미정산 금액 계산에 쓰는 증빙 한 건입니다. */
export interface OutstandingEvidence {
  side: 'SALES' | 'PURCHASE'
  partnerId: string | null
  classified: boolean
  totalAmount: number
  /** 이 증빙에 연결된 입출금 금액 합계입니다. */
  settledAmount: number
}

/** 거래처의 실시간 미정산 금액입니다. */
export interface OutstandingAmounts {
  salesAmount: number
  purchaseAmount: number
}

/**
 * 거래처별 실시간 미정산 금액입니다. `분류된 증빙 합계 − 연결 금액 합계`를 매출·매입으로 나눕니다.
 *
 * 미분류 증빙은 넣지 않습니다. 세무 보고서의 미수·미지급(결산 기준)과는 다른 숫자입니다.
 */
export function outstandingByPartner(evidence: ReadonlyArray<OutstandingEvidence>): Map<string, OutstandingAmounts> {
  const 거래처별미정산 = new Map<string, OutstandingAmounts>()
  for (const row of evidence) {
    if (row.partnerId === null || !row.classified) continue
    const 거래처미정산 = 거래처별미정산.get(row.partnerId) ?? { salesAmount: 0, purchaseAmount: 0 }
    const 증빙미정산금액 = row.totalAmount - row.settledAmount
    if (row.side === 'SALES') 거래처미정산.salesAmount += 증빙미정산금액
    else 거래처미정산.purchaseAmount += 증빙미정산금액
    거래처별미정산.set(row.partnerId, 거래처미정산)
  }
  return 거래처별미정산
}
