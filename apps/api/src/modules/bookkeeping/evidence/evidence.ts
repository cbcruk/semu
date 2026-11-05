import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { AccountTitleId, ClassificationRuleId, EvidenceId, PartnerId, SalesTransactionId } from '../common/ids.ts'
import { Amounts, CalendarDate } from '../common/wire.ts'

/** 증빙 방향입니다. */
export const EvidenceSide = Schema.Literals(['SALES', 'PURCHASE'])

/** 증빙 원천입니다. */
export const EvidenceSource = Schema.Literals(['TAX_INVOICE', 'CASH_RECEIPT', 'CARD', 'PG', 'MALL', 'DELIVERY'])

/** 분류 상태입니다. 목록 필터와 집계에 씁니다. */
export const ClassificationStatus = Schema.Literals(['CLASSIFIED', 'UNCLASSIFIED'])

/** 증빙·입출금이 함께 쓰는 분류 블록입니다. `status`는 계정과목 유무로 서버가 계산합니다. */
export const ClassificationView = Schema.Struct({
  status: ClassificationStatus,
  accountTitleId: Schema.NullOr(AccountTitleId),
  method: Schema.NullOr(Schema.Literals(['MANUAL', 'RULE'])),
  ruleId: Schema.NullOr(ClassificationRuleId),
})

/** 매입세액 공제 여부입니다. */
export const VatDeduction = Schema.Literals(['DEDUCTIBLE', 'NON_DEDUCTIBLE', 'UNDECIDED'])

/**
 * 매출·매입 증빙 한 건입니다.
 *
 * `amounts`는 빠진 공급가액·세액을 서버가 채운 값이고, 세액을 합계에서 나눴으면 `vatEstimated`가 참입니다.
 */
export const Evidence = Schema.Struct({
  id: EvidenceId,
  side: EvidenceSide,
  source: EvidenceSource,
  writtenOn: CalendarDate,
  issuedOn: CalendarDate,
  docType: Schema.NullOr(Schema.Literals(['TAX_INVOICE', 'MODIFIED_TAX_INVOICE', 'INVOICE', 'MODIFIED_INVOICE'])),
  kind: Schema.NullOr(Schema.Literals(['NORMAL', 'ZERO_RATE', 'DELEGATION', 'ZERO_RATE_DELEGATION'])),
  counterparty: Schema.Struct({ name: Schema.NullOr(Schema.String), businessNumber: Schema.NullOr(Schema.String) }),
  itemSummary: Schema.NullOr(Schema.String),
  amounts: Amounts,
  vatEstimated: Schema.Boolean,
  partnerId: Schema.NullOr(PartnerId),
  classification: ClassificationView,
  memo: Schema.NullOr(Schema.String),
  vatDeduction: VatDeduction,
  card: Schema.NullOr(
    Schema.Struct({
      numberMasked: Schema.String,
      companyCode: Schema.NullOr(Schema.String),
      approvalNo: Schema.NullOr(Schema.String),
    }),
  ),
  channel: Schema.NullOr(Schema.String),
  isCanceled: Schema.Boolean,
  salesTransactionId: Schema.NullOr(SalesTransactionId),
  syncedAt: Schema.String,
  version: Schema.Int,
})

export type Evidence = typeof Evidence.Type

/** 요청한 증빙이 없습니다. */
export class EvidenceNotFound extends HttpApiError.Problem<EvidenceNotFound>()(
  'EvidenceNotFound',
  { type: problemType('EVIDENCE_NOT_FOUND'), status: 404, title: 'Evidence not found' },
  { code: Schema.tag('EVIDENCE_NOT_FOUND') },
) {}

/** 매출 증빙에는 공제 여부가 없습니다. */
export class VatDeductionNotApplicable extends HttpApiError.Problem<VatDeductionNotApplicable>()(
  'VatDeductionNotApplicable',
  { type: problemType('VAT_DEDUCTION_NOT_APPLICABLE'), status: 422, title: 'Sales evidence has no VAT deduction' },
  { code: Schema.tag('VAT_DEDUCTION_NOT_APPLICABLE') },
) {}

/** 요청한 거래처가 없습니다. */
export class PartnerNotFound extends HttpApiError.Problem<PartnerNotFound>()(
  'PartnerNotFound',
  { type: problemType('PARTNER_NOT_FOUND'), status: 404, title: 'Partner not found' },
  { code: Schema.tag('PARTNER_NOT_FOUND') },
) {}

/** 일괄 처리 대상 중 없는 행이 있습니다. 아무것도 바꾸지 않았습니다. */
export class BatchTargetMissing extends HttpApiError.Problem<BatchTargetMissing>()(
  'BatchTargetMissing',
  { type: problemType('BATCH_TARGET_MISSING'), status: 422, title: 'Some targets do not exist' },
  { code: Schema.tag('BATCH_TARGET_MISSING'), missingIds: Schema.Array(Schema.String) },
) {}
