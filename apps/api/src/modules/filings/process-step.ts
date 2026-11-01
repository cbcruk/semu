import type { TaxType } from '../tax-calendar/tax-calendar.types'
import type { FilingStatus, ProcessStepInfo } from './filings.types'

/** Step labels shown to users, matching the legacy `ProcessStep` enum for VAT. */
export const PROCESS_STEPS = {
  surtax: ['자료 제출 가능', '자료 검토중', '매입매출장 확인', '부가세 작업중', '부가세 납부', '부가세 마감'],
  default: ['자료 제출 가능', '자료 검토중', '작업중', '납부', '마감'],
} as const satisfies Record<string, readonly string[]>

const SURTAX_STEP_INDEX: Partial<Record<FilingStatus, number>> = {
  requested: 1,
  submitted: 2,
  reviewing: 2,
  ledger_pending: 3,
  preparing: 4,
  filed: 5,
  settled: 6,
}

const DEFAULT_STEP_INDEX: Partial<Record<FilingStatus, number>> = {
  requested: 1,
  submitted: 2,
  reviewing: 2,
  preparing: 3,
  filed: 4,
  settled: 5,
}

/**
 * Maps a filing status to its legacy step label and 1-based position.
 *
 * `scheduled` and `cancelled` have no legacy step and return index 0.
 */
export function processStepOf(taxType: TaxType, status: FilingStatus): ProcessStepInfo {
  const steps: readonly string[] = taxType === 'surtax' ? PROCESS_STEPS.surtax : PROCESS_STEPS.default
  const index = (taxType === 'surtax' ? SURTAX_STEP_INDEX : DEFAULT_STEP_INDEX)[status] ?? 0
  return { step: index > 0 ? (steps[index - 1] ?? null) : null, index, count: steps.length }
}
