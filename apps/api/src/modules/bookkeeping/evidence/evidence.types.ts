import type { Id } from '../../../shared/ids/ids.types.ts'

/** 증빙 방향입니다. 매출 증빙과 매입 증빙은 한 리소스이고 이 값으로 나뉩니다. */
export type EvidenceSide = 'SALES' | 'PURCHASE'

/** 증빙 원천입니다. 매입은 `TAX_INVOICE`·`CASH_RECEIPT`·`CARD`만 있습니다. `MALL`은 현행 `online` 탭(올라)입니다. */
export type EvidenceSource = 'TAX_INVOICE' | 'CASH_RECEIPT' | 'CARD' | 'PG' | 'MALL' | 'DELIVERY'

/** 문서 종류입니다. `InvoiceClass` 01–04에 대응합니다. */
export type EvidenceDocType = 'TAX_INVOICE' | 'MODIFIED_TAX_INVOICE' | 'INVOICE' | 'MODIFIED_INVOICE'

/** 세금계산서 종류입니다. `InvoiceKind` 01–04에 대응합니다. */
export type EvidenceKind = 'NORMAL' | 'ZERO_RATE' | 'DELEGATION' | 'ZERO_RATE_DELEGATION'

/** 누가 분류했는지입니다. */
export type ClassificationMethod = 'MANUAL' | 'RULE'

/** 매입세액 공제 여부입니다. 현행 `deductible` `1 | 0 | null`입니다. */
export type VatDeduction = 'DEDUCTIBLE' | 'NON_DEDUCTIBLE' | 'UNDECIDED'

/** 거래(증빙·입출금)의 분류 상태입니다. 계정과목이 없으면 미분류입니다. */
export interface Classification {
  accountTitleId: Id<'accountTitle'> | null
  method: ClassificationMethod | null
  ruleId: Id<'classificationRule'> | null
}

/**
 * 저장한 증빙 한 건입니다. 금액은 수집한 값 그대로 두고(빠진 값은 `null`), 응답할 때
 * `evidenceAmounts`로 채웁니다. 예상 부가세가 "세액을 받았는지"를 구분해야 하기 때문입니다.
 */
export interface EvidenceRecord {
  id: Id<'evidence'>
  companyId: Id<'company'>
  side: EvidenceSide
  source: EvidenceSource
  /** 원천 안에서 유일한 수집 키입니다. 세금계산서는 승인번호, 카드는 승인번호:카드번호:승인시각입니다. */
  externalKey: string
  /** 작성일자입니다. 세금계산서가 아니면 발급일자와 같습니다. */
  writtenOn: string
  issuedOn: string
  docType: EvidenceDocType | null
  kind: EvidenceKind | null
  counterpartyName: string | null
  /** `-` 없는 숫자 10자리입니다. */
  counterpartyBusinessNumber: string | null
  itemSummary: string | null
  totalAmount: number | null
  supplyAmount: number | null
  vatAmount: number | null
  partnerId: Id<'partner'> | null
  classification: Classification
  memo: string | null
  /** 매입만 씁니다. 매출은 항상 `UNDECIDED`입니다. */
  vatDeduction: VatDeduction
  card: { numberMasked: string; companyCode: string | null; approvalNo: string | null } | null
  /** PG사·배달앱·쇼핑몰 채널 원문입니다. */
  channel: string | null
  isCanceled: boolean
  /** 같은 매출이 여러 원천으로 들어온 묶음 키입니다. 예상 부가세가 묶음당 한 건만 셉니다. */
  dedupeGroup: string | null
  salesTransactionId: Id<'salesTransaction'> | null
  syncedAt: string
  version: number
}
