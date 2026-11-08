import { newId } from '../../../shared/ids/ids.ts'
import type { FilingDocumentType, FilingStatus } from '../tax.types.ts'
import type { FilingDocumentId, FilingDocumentRecord } from './filing.types.ts'

const 매입매출장이보이는상태: ReadonlyArray<FilingStatus> = ['LEDGER_PENDING', 'PREPARING', 'FILED', 'SETTLED']
/** 결과 문서는 신고서(`RETURN`)·납부서(`PAYMENT_SLIP`)·고지서(`NOTICE`)입니다. */
const 결과문서가보이는상태: ReadonlyArray<FilingStatus> = ['FILED', 'SETTLED']

/**
 * 고객이 지금 상태에서 이 문서를 볼 수 있는지입니다.
 *
 * 매입매출장은 확인 단계(`LEDGER_PENDING`)부터, 신고서·납부서·고지서는 신고 뒤(`FILED`)부터 보입니다.
 * 다른 문서로 바뀐 문서는 보이지 않습니다. 대리인은 모든 문서를 봅니다.
 */
export function isDocumentVisibleToClient(
  document: Pick<FilingDocumentRecord, 'type' | 'replacedAt'>,
  status: FilingStatus,
): boolean {
  if (document.replacedAt !== null) return false
  return (document.type === 'LEDGER' ? 매입매출장이보이는상태 : 결과문서가보이는상태).includes(status)
}

/**
 * 문서를 붙입니다. 같은 종류의 문서가 이미 있으면 그 문서에 `replacedAt`을 남깁니다.
 *
 * 문서 기록은 지우지 않습니다. 고객이 처음 연 시각도 그대로 남습니다.
 */
export function attachDocument(
  documents: ReadonlyArray<FilingDocumentRecord>,
  added: { type: FilingDocumentType; fileId: FilingDocumentRecord['fileId'] },
  now: string,
): FilingDocumentRecord[] {
  const 기존문서 = documents.map((document) =>
    document.type === added.type && document.replacedAt === null ? { ...document, replacedAt: now } : document,
  )
  return [
    ...기존문서,
    {
      id: newFilingDocumentId(),
      type: added.type,
      fileId: added.fileId,
      createdAt: now,
      firstViewedAt: null,
      replacedAt: null,
    },
  ]
}

/** 새 신고 건 문서 ID를 만듭니다. */
export function newFilingDocumentId(): FilingDocumentId {
  return newId('filingDocument')
}
