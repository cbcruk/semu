import type { FilingCommand, FilingKind, FilingStatus, TaxType } from './tax.types.ts'

/**
 * 현행 `tax_type` → `TaxType`입니다.
 *
 * 이 파일의 표는 현행 구현(`apps/api/legacy/`)의 이름을 재설계 enum으로 옮깁니다. 픽스처 테스트와 데이터 이관이 씁니다.
 */
export const LEGACY_TAX_TYPE: Record<string, TaxType> = {
  surtax: 'VAT',
  withholding_tax: 'WITHHOLDING_TAX',
  corporation_tax: 'CORPORATE_TAX',
  aggr_income_tax: 'INCOME_TAX',
}

/** 현행 `status` → `FilingStatus`입니다. `cancelled`는 `CANCELED`가 됩니다. */
export const LEGACY_FILING_STATUS: Record<string, FilingStatus> = {
  scheduled: 'SCHEDULED',
  requested: 'REQUESTED',
  submitted: 'SUBMITTED',
  reviewing: 'REVIEWING',
  ledger_pending: 'LEDGER_PENDING',
  preparing: 'PREPARING',
  filed: 'FILED',
  settled: 'SETTLED',
  cancelled: 'CANCELED',
}

/** 현행 `kind` → `FilingKind`입니다. */
export const LEGACY_FILING_KIND: Record<string, FilingKind> = {
  preliminary: 'PRELIMINARY',
  final: 'FINAL',
  notice: 'NOTICE',
  monthly: 'MONTHLY',
  semiannual: 'SEMIANNUAL',
  annual: 'ANNUAL',
}

/** 현행 전이 이름 → `FilingCommand`입니다. */
export const LEGACY_TRANSITION: Record<string, FilingCommand> = {
  request: 'REQUEST',
  submit: 'SUBMIT',
  unsubmit: 'UNSUBMIT',
  startReview: 'START_REVIEW',
  reject: 'REJECT',
  uploadLedger: 'UPLOAD_LEDGER',
  confirmLedger: 'CONFIRM_LEDGER',
  disputeLedger: 'DISPUTE_LEDGER',
  startPreparing: 'START_PREPARING',
  file: 'FILE',
  recordNotice: 'RECORD_NOTICE',
  pay: 'PAY',
  close: 'CLOSE',
  cancel: 'CANCEL',
}

/**
 * 현행 `tax_period_key`를 재설계의 세목·종류·기간 이름으로 바꿉니다.
 *
 * @example
 * ```ts
 * fromLegacyPeriodKey('surtax', '2026-2-preliminary') // { taxType: 'VAT', kind: 'PRELIMINARY', periodKey: '2026-H2' }
 * ```
 */
export function fromLegacyPeriodKey(
  legacyTaxType: string,
  key: string,
): { taxType: TaxType; kind: FilingKind; periodKey: string } {
  const taxType = LEGACY_TAX_TYPE[legacyTaxType]
  if (taxType === undefined) throw new RangeError(`Unknown tax type ${legacyTaxType}`)
  const vat = /^(\d{4})-([12])-(preliminary|final|notice)$/.exec(key)
  if (vat !== null) return { taxType, kind: LEGACY_FILING_KIND[vat[3]!]!, periodKey: `${vat[1]}-H${vat[2]}` }
  const monthly = /^(\d{4}-\d{2})-payment$/.exec(key)
  if (monthly !== null) return { taxType, kind: 'MONTHLY', periodKey: monthly[1]! }
  const semiannual = /^(\d{4}-H[12])-semiannual$/.exec(key)
  if (semiannual !== null) return { taxType, kind: 'SEMIANNUAL', periodKey: semiannual[1]! }
  const annual = /^(\d{4})-(FY|annual)$/.exec(key)
  if (annual !== null) return { taxType, kind: 'ANNUAL', periodKey: annual[1]! }
  throw new RangeError(`Unknown period key ${key}`)
}
