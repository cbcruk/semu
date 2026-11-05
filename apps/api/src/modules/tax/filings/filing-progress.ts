import type { FilingStatus, TaxType } from '../tax.types.ts'
import { PRE_FILING_STATUSES } from './filing-status.ts'
import type { FilingProgress, FilingStage } from './filing-progress.types.ts'

const VAT_STAGES: ReadonlyArray<FilingStage> = [
  'MATERIALS_OPEN',
  'UNDER_REVIEW',
  'LEDGER_CONFIRMATION',
  'PREPARING',
  'PAYMENT',
  'CLOSED',
]

const DEFAULT_STAGES: ReadonlyArray<FilingStage> = ['MATERIALS_OPEN', 'UNDER_REVIEW', 'PREPARING', 'PAYMENT', 'CLOSED']

const STAGE_OF_STATUS: Partial<Record<FilingStatus, FilingStage>> = {
  REQUESTED: 'MATERIALS_OPEN',
  SUBMITTED: 'UNDER_REVIEW',
  REVIEWING: 'UNDER_REVIEW',
  LEDGER_PENDING: 'LEDGER_CONFIRMATION',
  PREPARING: 'PREPARING',
  FILED: 'PAYMENT',
  SETTLED: 'CLOSED',
}

/**
 * 진행 막대에 그릴 단계와 위치입니다. 현행 `ProcessStep`(`자료 제출 가능` … `부가세 마감`)을 대신합니다.
 *
 * 부가세만 `LEDGER_CONFIRMATION` 단계가 있어 6단계이고, 다른 세목은 5단계입니다.
 * `SCHEDULED`·`CANCELED`는 단계가 없어 `stage`가 `null`, `index`가 0입니다. 단계 이름 문구는 클라이언트가 고릅니다.
 */
export function filingProgress(taxType: TaxType, status: FilingStatus): FilingProgress {
  const stages = taxType === 'VAT' ? VAT_STAGES : DEFAULT_STAGES
  const stage = STAGE_OF_STATUS[status] ?? null
  const index = stage === null ? 0 : stages.indexOf(stage) + 1
  return { stage, index, count: stages.length }
}

/**
 * 신고서를 내기 전인데 기한이 지났는지입니다. 상태로 저장하지 않고 회사 시간대 오늘로 계산합니다.
 *
 * 기한은 신고 기한이고, 신고 기한이 없는 예정고지는 납부 기한입니다. 기한 당일은 지난 것이 아닙니다.
 */
export function isFilingOverdue(
  filing: { status: FilingStatus; dueDate: string | null; paymentDue: string | null },
  today: string,
): boolean {
  const deadline = filing.dueDate ?? filing.paymentDue
  return deadline !== null && deadline < today && PRE_FILING_STATUSES.includes(filing.status)
}
