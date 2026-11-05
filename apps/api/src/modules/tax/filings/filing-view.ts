import type { FilingStatusChanged } from '../tax.public.ts'
import type { FilingActorKind } from '../tax.types.ts'
import type { Filing, FilingSummary } from './filing.ts'
import type { FilingRecord } from './filing.types.ts'
import { isDocumentVisibleToClient } from './filing-documents.ts'
import { filingProgress, isFilingOverdue } from './filing-progress.ts'
import { allowedFilingCommands } from './filing-status.ts'
import type { FilingTransitionFacts } from './filing-status.types.ts'

/** 전이표가 보는 신고 건의 사실입니다. */
export function transitionFacts(filing: FilingRecord): FilingTransitionFacts {
  return {
    taxType: filing.taxType,
    kind: filing.kind,
    payableAmount: filing.payableAmount,
    pendingRequirementCodes: filing.requirements
      .filter((requirement) => !requirement.autoLinked && requirement.response === 'PENDING')
      .map((requirement) => requirement.code),
  }
}

/** 목록 응답 항목입니다. `isOverdue`와 `progress`는 저장하지 않고 계산합니다. */
export function toFilingSummary(filing: FilingRecord, today: string): FilingSummary {
  return {
    id: filing.id,
    taxType: filing.taxType,
    kind: filing.kind,
    periodKey: filing.periodKey,
    revision: filing.revision,
    periodStart: filing.periodStart,
    periodEnd: filing.periodEnd,
    statutoryDue: filing.statutoryDue,
    dueDate: filing.dueDate,
    paymentDue: filing.paymentDue,
    submitDue: filing.submitDue,
    status: filing.status,
    isOverdue: isFilingOverdue(filing, today),
    progress: filingProgress(filing.taxType, filing.status),
    payableAmount: filing.payableAmount,
    settlement: filing.settlement,
    paidOn: filing.paidOn,
    ledgerUploadedAt: filing.ledgerUploadedAt,
    ledgerConfirmedAt: filing.ledgerConfirmedAt,
    ledgerDisputeCount: filing.ledgerDisputeCount,
    paymentSlipSentAt: filing.paymentSlipSentAt,
    version: filing.version,
    updatedAt: filing.updatedAt,
  }
}

/** 상세 응답입니다. 고객에게는 볼 수 있는 문서만 주고, `allowedActions`는 보는 행위자 기준입니다. */
export function toFiling(filing: FilingRecord, viewer: FilingActorKind, today: string): Filing {
  return {
    ...toFilingSummary(filing, today),
    requirements: filing.requirements.map((requirement) => ({
      code: requirement.code,
      response: requirement.response,
      autoLinked: requirement.autoLinked,
      note: requirement.note,
      fileIds: requirement.fileIds,
      updatedAt: requirement.updatedAt,
    })),
    documents: filing.documents.filter(
      (document) => viewer === 'AGENCY' || isDocumentVisibleToClient(document, filing.status),
    ),
    allowedActions: allowedFilingCommands(filing.status, viewer, transitionFacts(filing)),
  }
}

/** 상태가 바뀐 신고 건의 공개 이벤트입니다. */
export function filingStatusChanged(before: FilingRecord, after: FilingRecord, now: string): FilingStatusChanged {
  return {
    type: 'filing.status_changed',
    companyId: after.companyId,
    filingId: after.id,
    taxType: after.taxType,
    kind: after.kind,
    periodStart: after.periodStart,
    periodEnd: after.periodEnd,
    fromStatus: before.status,
    toStatus: after.status,
    payableAmount: after.payableAmount,
    occurredAt: now,
  }
}
