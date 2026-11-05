import { companyDateOf, isCalendarDate } from '../../../shared/time/date-format.ts'
import type { EvidenceSource } from '../evidence/evidence.types.ts'
import type { IngestionRejection, ScrapedCardApproval, ScrapedEvidence, ScrapedRecord } from './scraped-record.types.ts'

const KIND_ORDER: Record<ScrapedRecord['type'], number> = {
  BANK_ACCOUNT: 0,
  BANK_TRANSACTION: 1,
  BANK_BALANCE: 1,
  SALES_EVIDENCE: 1,
  PURCHASE_EVIDENCE: 1,
  CARD_APPROVAL: 1,
  GIRO_BILLS: 1,
}

/** 매입 증빙이 가질 수 있는 원천입니다. */
export const PURCHASE_SOURCES: ReadonlyArray<EvidenceSource> = ['TAX_INVOICE', 'CASH_RECEIPT', 'CARD']

/**
 * 레코드를 처리할 순서입니다. 계좌를 먼저, 나머지는 보낸 순서대로 처리합니다(현행과 같음).
 *
 * 계좌를 먼저 만들어야 같은 묶음의 거래·잔액이 그 계좌에 붙습니다. 은행 잔액과 거래로 만든 잔액의 우선순위는
 * 순서가 아니라 `mergeSnapshot`이 정합니다.
 */
export function processingOrder(records: ReadonlyArray<Pick<ScrapedRecord, 'type'>>): number[] {
  return records
    .map((record, index) => ({ index, order: KIND_ORDER[record.type] }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((entry) => entry.index)
}

/** 카드 승인 한 건을 매입 카드 증빙으로 바꿉니다. 세액이 없으면 0으로 둡니다(현행과 같음). */
export function cardApprovalEvidence(record: ScrapedCardApproval): ScrapedEvidence {
  const date = companyDateOf(record.approvedAt) ?? record.approvedAt.slice(0, 10)
  const vat = record.vatAmount ?? 0
  return {
    type: 'PURCHASE_EVIDENCE',
    source: 'CARD',
    externalKey: `${record.approvalNo}:${record.cardNumberMasked}:${record.approvedAt}`,
    writtenOn: date,
    issuedOn: date,
    ...(record.merchantName === undefined ? {} : { counterpartyName: record.merchantName }),
    ...(record.merchantBusinessNumber === undefined
      ? {}
      : { counterpartyBusinessNumber: record.merchantBusinessNumber }),
    totalAmount: record.amount,
    supplyAmount: record.amount - vat,
    vatAmount: vat,
    card: {
      numberMasked: record.cardNumberMasked,
      approvalNo: record.approvalNo,
      ...(record.cardCompanyCode === undefined ? {} : { companyCode: record.cardCompanyCode }),
    },
    isCanceled: record.isCanceled ?? record.amount < 0,
  }
}

/** 증빙 레코드를 받을 수 없는 이유입니다. 받을 수 있으면 `undefined`입니다. */
export function evidenceRejection(record: ScrapedEvidence): IngestionRejection | undefined {
  if (record.externalKey.trim() === '') return 'EXTERNAL_KEY_MISSING'
  if (!isCalendarDate(record.writtenOn) || (record.issuedOn !== undefined && !isCalendarDate(record.issuedOn))) {
    return 'DATE_INVALID'
  }
  if (record.type === 'PURCHASE_EVIDENCE' && !PURCHASE_SOURCES.includes(record.source)) return 'SOURCE_SIDE_MISMATCH'
  if (record.totalAmount === undefined && record.supplyAmount === undefined) return 'AMOUNTS_MISSING'
  return undefined
}
