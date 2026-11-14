import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { FilingObligation } from '../calendar/filing-calendar.types.ts'
import type { TaxEvent } from '../tax.public.ts'
import type { FilingActorKind, FilingCommand, FilingStatus, RequirementResponse } from '../tax.types.ts'
import {
  FilingActorNotAllowed,
  FilingDocumentNotFound,
  FilingLocked,
  FilingRequirementsPending,
  FilingTransitionInvalid,
  RequirementAutoLinked,
  RequirementFileNotFound,
  RequirementHasFiles,
  RequirementNotFound,
} from './filing.ts'
import type {
  FilingDocumentId,
  FilingDocumentRecord,
  FilingHistoryRecord,
  FilingRecord,
  RequirementRecord,
} from './filing.types.ts'
import { attachDocument, isDocumentVisibleToClient } from './filing-documents.ts'
import { answerRequirement, relinkRequirements, responseAfterFiles } from './filing-requirements.ts'
import type {
  PayrollLedgerSummary,
  RequirementAnswer,
  RequirementCode,
  RequirementTemplate,
} from './filing-requirements.types.ts'
import { CLIENT_EDITABLE_STATUSES, transitionFiling } from './filing-status.ts'
import { filingStatusChanged, transitionFacts } from './filing-view.ts'

/**
 * 신고 건 애그리거트입니다(docs/design/domain-model.md). 커맨드 입력, 거부, 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 저장소·권한·시계를 모르고, 시각과 행위자는 {@link FilingDecisionContext}로, 서비스가 읽어 둔
 * 사실(급여대장 마감 현황)은 인자로 받습니다. 결과는 저장할 신고 건과 그 변경이 낸 이벤트이거나 거부입니다. 새 문서 ID만은
 * `attachDocument`가 만들어 같은 입력에도 다릅니다.
 *
 * 전이표(`filing-status.ts`)와 제출 자료 규칙(`filing-requirements.ts`)은 규칙 모듈에 그대로 두고 여기서 부릅니다.
 * 버전 검사(`If-Match`)는 동시성 규칙이라 서비스가 맡습니다.
 */

/** 판정 함수가 받는 시각과 행위자입니다. 일정 배치처럼 사람이 없는 커맨드는 `actor`가 없습니다. */
export interface FilingDecisionContext {
  /** 커맨드를 처리하는 시각입니다(RFC 3339). */
  at: string
  actor: { kind: FilingActorKind; userId: Id<'user'> }
}

/** 판정 결과입니다. `events`는 `filing`과 같은 트랜잭션에 냅니다. */
export interface FilingDecision {
  filing: FilingRecord
  events: TaxEvent[]
}

/** 커맨드마다 함께 받는 입력입니다. */
export type FilingCommandInput =
  | { command: 'REQUEST'; submitDue: string; message?: string }
  | { command: 'SUBMIT' | 'UNSUBMIT' | 'START_REVIEW' | 'CONFIRM_LEDGER' | 'START_PREPARING' | 'CLOSE' }
  | { command: 'REJECT'; reason: string; submitDue: string }
  | { command: 'UPLOAD_LEDGER'; ledgerFileId: Id<'file'> }
  | { command: 'DISPUTE_LEDGER'; reason: string }
  | {
      command: 'FILE'
      payableAmount: number
      paymentDue?: string
      returnFileId: Id<'file'>
      paymentSlipFileId?: Id<'file'>
    }
  | { command: 'RECORD_NOTICE'; payableAmount: number; paymentDue: string; noticeFileId: Id<'file'> }
  | { command: 'PAY'; paidOn: string }
  | { command: 'CANCEL'; reason: string }

/** 상태 커맨드를 거부하는 이유입니다. */
export type FilingCommandRejection = FilingTransitionInvalid | FilingActorNotAllowed | FilingRequirementsPending

/** 제출 자료 쓰기를 거부하는 이유입니다. */
export type RequirementEditRejection =
  FilingLocked | RequirementNotFound | RequirementAutoLinked | RequirementHasFiles | RequirementFileNotFound

/** 대리인 문서 붙이기를 거부하는 이유입니다. */
export type DocumentAddRejection = FilingLocked | FilingActorNotAllowed

/** 신고서·납부서를 붙이거나 바꿀 수 있는 상태입니다. */
const DOCUMENT_STATUSES: ReadonlyArray<FilingStatus> = ['PREPARING', 'FILED']

/**
 * 상태 커맨드를 판정합니다. 전이표가 허락하면 커맨드 값을 채우고 이력 한 줄을 남기며 버전을 올립니다. 상태가 바뀌면
 * `filing.status_changed`를 냅니다(대리인이 매입매출장을 다시 올리는 `UPLOAD_LEDGER`처럼 상태가 그대로인 커맨드는 내지 않습니다).
 *
 * @example 아직 답하지 않은 항목이 있는 제출
 * ```ts
 * decideFilingCommand(requested, { command: 'SUBMIT' }, context) // Failure(FilingRequirementsPending)
 * ```
 */
export function decideFilingCommand(
  filing: FilingRecord,
  input: FilingCommandInput,
  context: FilingDecisionContext,
): Result.Result<FilingDecision, FilingCommandRejection> {
  const facts = transitionFacts(filing)
  const result = transitionFiling(filing.status, input.command, context.actor.kind, facts)
  if (!result.ok) {
    switch (result.code) {
      case 'FILING_ACTOR_NOT_ALLOWED':
        return Result.fail(
          new FilingActorNotAllowed({ action: input.command, requiredActorKind: result.requiredActor! }),
        )
      case 'FILING_REQUIREMENTS_PENDING':
        return Result.fail(
          new FilingRequirementsPending({ requirementCodes: facts.pendingRequirementCodes as RequirementCode[] }),
        )
      case 'FILING_TRANSITION_INVALID':
        return Result.fail(new FilingTransitionInvalid({ currentStatus: filing.status, command: input.command }))
    }
  }
  const next: FilingRecord = {
    ...filing,
    ...commandPatch(filing, input, context.at),
    status: result.to,
    history: [...filing.history, commandEntry(context, input, filing.status, result.to, result.onBehalfOf)],
    version: filing.version + 1,
    updatedAt: context.at,
  }
  return Result.succeed({ filing: next, events: statusEvents(filing, next, context.at) })
}

/** 고객이 항목에 해당 없음·미제출을 고르고 메모를 남기는 것을 판정합니다. */
export function decideRequirementAnswer(
  filing: FilingRecord,
  code: RequirementCode,
  answer: { response: RequirementAnswer; note?: string | null },
  context: FilingDecisionContext,
): Result.Result<FilingDecision, RequirementEditRejection> {
  return editRequirement(
    filing,
    code,
    (requirement) => {
      const result = answerRequirement({ autoLinked: false, fileCount: requirement.fileIds.length }, answer.response)
      if (!result.ok) return Result.fail(new RequirementHasFiles({}))
      return Result.succeed({
        ...requirement,
        response: result.response,
        ...(answer.note === undefined ? {} : { note: answer.note }),
      })
    },
    'REQUIREMENT_ANSWERED',
    { response: answer.response },
    context,
  )
}

/** 항목에 파일을 붙이는 것을 판정합니다. 이미 붙은 파일이면 목록은 그대로이고 이력만 남깁니다. 항목은 `PROVIDED`가 됩니다. */
export function decideRequirementFileAttach(
  filing: FilingRecord,
  code: RequirementCode,
  fileId: Id<'file'>,
  context: FilingDecisionContext,
): Result.Result<FilingDecision, RequirementEditRejection> {
  return editRequirement(
    filing,
    code,
    (requirement) => {
      const fileIds = requirement.fileIds.includes(fileId) ? requirement.fileIds : [...requirement.fileIds, fileId]
      return Result.succeed({ ...requirement, fileIds, response: responseAfterFiles(fileIds.length) })
    },
    'REQUIREMENT_FILE_ADDED',
    { fileId },
    context,
  )
}

/** 항목에서 파일을 떼는 것을 판정합니다. 마지막 파일이면 항목이 `PENDING`으로 돌아갑니다. */
export function decideRequirementFileDetach(
  filing: FilingRecord,
  code: RequirementCode,
  fileId: Id<'file'>,
  context: FilingDecisionContext,
): Result.Result<FilingDecision, RequirementEditRejection> {
  return editRequirement(
    filing,
    code,
    (requirement) => {
      if (!requirement.fileIds.includes(fileId)) return Result.fail(new RequirementFileNotFound({}))
      const fileIds = requirement.fileIds.filter((candidate) => candidate !== fileId)
      return Result.succeed({ ...requirement, fileIds, response: responseAfterFiles(fileIds.length) })
    },
    'REQUIREMENT_FILE_REMOVED',
    { fileId },
    context,
  )
}

/** 대리인이 신고서·납부서를 붙이거나 바꾸는 것을 판정합니다. 신고 뒤 납부서를 붙이면 `paymentSlipSentAt`을 남깁니다. */
export function decideDocumentAdd(
  filing: FilingRecord,
  document: { type: 'RETURN' | 'PAYMENT_SLIP'; fileId: Id<'file'> },
  context: FilingDecisionContext,
): Result.Result<FilingDecision, DocumentAddRejection> {
  if (context.actor.kind !== 'AGENCY') {
    return Result.fail(new FilingActorNotAllowed({ action: 'ADD_DOCUMENT', requiredActorKind: 'AGENCY' }))
  }
  if (!DOCUMENT_STATUSES.includes(filing.status)) return Result.fail(new FilingLocked({ currentStatus: filing.status }))
  const next: FilingRecord = {
    ...filing,
    documents: attachDocument(filing.documents, document, context.at),
    ...(document.type === 'PAYMENT_SLIP' && filing.status === 'FILED' ? { paymentSlipSentAt: context.at } : {}),
    history: [
      ...filing.history,
      {
        type: 'DOCUMENT_ADDED',
        actorKind: context.actor.kind,
        actorId: context.actor.userId,
        fromStatus: null,
        toStatus: null,
        detail: { ...document },
        occurredAt: context.at,
      },
    ],
    version: filing.version + 1,
    updatedAt: context.at,
  }
  return Result.succeed({ filing: next, events: [] })
}

/** 문서 열람의 판정 결과입니다. 처음 연 고객이면 열람 시각을 남긴 신고 건이 있고, 아니면 `filing`이 `null`입니다. */
export interface DocumentViewDecision {
  document: FilingDocumentRecord
  filing: FilingRecord | null
}

/**
 * 문서 하나를 여는 것을 판정합니다. 고객은 지금 상태에서 볼 수 있는 문서만 엽니다. 고객이 처음 열면 열람 시각을 남깁니다.
 *
 * 열람 시각은 이력·버전에 넣지 않습니다. 열람은 신고 건 내용을 바꾸지 않아, 화면이 들고 있는 `version`으로 낸 커맨드가
 * 열람 때문에 버전 충돌이 나지 않게 하려는 것입니다.
 */
export function decideDocumentView(
  filing: FilingRecord,
  documentId: FilingDocumentId,
  context: FilingDecisionContext,
): Result.Result<DocumentViewDecision, FilingDocumentNotFound> {
  const document = filing.documents.find((candidate) => candidate.id === documentId)
  if (
    document === undefined ||
    (context.actor.kind === 'CLIENT' && !isDocumentVisibleToClient(document, filing.status))
  ) {
    return Result.fail(new FilingDocumentNotFound({}))
  }
  if (context.actor.kind !== 'CLIENT' || document.firstViewedAt !== null) {
    return Result.succeed({ document, filing: null })
  }
  const viewed = { ...document, firstViewedAt: context.at }
  return Result.succeed({
    document: viewed,
    filing: {
      ...filing,
      documents: filing.documents.map((candidate) => (candidate.id === documentId ? viewed : candidate)),
    },
  })
}

/**
 * 자동 연계 항목을 급여대장 마감 현황으로 다시 맞춘 신고 건입니다({@link relinkRequirements}). 고객·대리인이 답한 항목은
 * 그대로 둡니다. 바뀐 항목마다 이력 `REQUIREMENT_LINKED`(`detail`에 `code`·`response`를 더함)를 남기고, 바뀐 것이 없으면
 * `null`입니다. 버전은 올리지 않습니다. 부르는 판정이 올립니다.
 */
function relinkedFiling(
  filing: FilingRecord,
  summary: PayrollLedgerSummary,
  at: string,
  detail: Record<string, string | number>,
): FilingRecord | null {
  const relinked = relinkRequirements(filing.requirements, summary, at)
  if (relinked.changed.length === 0) return null
  return {
    ...filing,
    requirements: relinked.requirements,
    history: [
      ...filing.history,
      ...relinked.changed.map(({ code, response }) =>
        systemEntry('REQUIREMENT_LINKED', null, null, { code, response, ...detail }, at),
      ),
    ],
  }
}

/**
 * 급여대장 마감이 바뀐 지급월의 원천세 신고 건을 다시 맞추는 것을 판정합니다(정책 "원천세 급여대장 항목"). 바뀐 항목이 없으면
 * `null`입니다. 취소된 신고 건은 부르는 쪽이 거릅니다. 되살릴 때 다시 맞춥니다({@link decideScheduleRestore}).
 */
export function decidePayrollLedgerRelink(
  filing: FilingRecord,
  summary: PayrollLedgerSummary,
  at: string,
  detail: Record<string, string | number>,
): FilingDecision | null {
  const relinked = relinkedFiling(filing, summary, at, detail)
  if (relinked === null) return null
  return { filing: { ...relinked, version: filing.version + 1, updatedAt: at }, events: [] }
}

/** 자동 연계 항목이 있는 신고 건인지입니다. 없으면 서비스가 Payroll에 묻지 않습니다. */
export function hasAutoLinkedRequirements(filing: FilingRecord): boolean {
  return filing.requirements.some((requirement) => requirement.autoLinked)
}

/** 일정 배치가 새 신고 건을 만들 때 받는 값입니다. */
export interface ScheduledFilingInput {
  id: Id<'filing'>
  companyId: Id<'company'>
  obligation: FilingObligation
  templates: ReadonlyArray<RequirementTemplate>
  /** 자동 연계 항목의 첫 응답입니다. 서비스가 급여대장 마감 현황에서 정합니다. */
  linkedResponse: RequirementResponse
}

/** 일정 배치가 계산한 의무로 `SCHEDULED` 신고 건을 만듭니다. 생성은 상태 변경이 아니라 이벤트가 없습니다. */
export function decideScheduledFiling(input: ScheduledFilingInput, at: string): FilingDecision {
  const { obligation } = input
  const filing: FilingRecord = {
    id: input.id,
    companyId: input.companyId,
    taxType: obligation.taxType,
    kind: obligation.kind,
    periodKey: obligation.periodKey,
    revision: 0,
    periodStart: obligation.periodStart,
    periodEnd: obligation.periodEnd,
    statutoryDue: obligation.statutoryDue,
    dueDate: obligation.dueDate,
    paymentDue: obligation.paymentDue,
    submitDue: null,
    status: 'SCHEDULED',
    payableAmount: null,
    settlement: null,
    paidOn: null,
    ledgerUploadedAt: null,
    ledgerConfirmedAt: null,
    ledgerDisputeCount: 0,
    paymentSlipSentAt: null,
    requirements: input.templates.map((template) => ({
      code: template.code,
      response: template.autoLinked ? input.linkedResponse : 'PENDING',
      autoLinked: template.autoLinked,
      note: null,
      fileIds: [],
      updatedBy: null,
      updatedAt: null,
    })),
    documents: [],
    history: [systemEntry('SCHEDULED', null, 'SCHEDULED', {}, at)],
    version: 1,
    createdAt: at,
    updatedAt: at,
  }
  return { filing, events: [] }
}

/** 일정 배치가 다시 계산한 기한으로 신고 건의 기한을 고칩니다. */
export function decideDeadlineRefresh(filing: FilingRecord, obligation: FilingObligation, at: string): FilingDecision {
  return {
    filing: {
      ...filing,
      ...deadlinesOf(obligation),
      history: [
        ...filing.history,
        systemEntry(
          'DEADLINES_REFRESHED',
          null,
          null,
          { dueDate: obligation.dueDate ?? '', paymentDue: obligation.paymentDue },
          at,
        ),
      ],
      version: filing.version + 1,
      updatedAt: at,
    },
    events: [],
  }
}

/**
 * 배치가 취소했던 신고 건을 의무가 다시 생겨 `SCHEDULED`로 되살립니다. 취소된 동안 급여대장 정책이 이 건을 건너뛰었으므로,
 * 자동 연계 항목이 있으면 서비스가 읽은 지금 마감 현황(`summary`)으로 다시 맞춥니다.
 */
export function decideScheduleRestore(
  filing: FilingRecord,
  obligation: FilingObligation,
  summary: PayrollLedgerSummary | null,
  at: string,
): FilingDecision {
  const restored: FilingRecord = {
    ...filing,
    status: 'SCHEDULED',
    ...deadlinesOf(obligation),
    history: [...filing.history, systemEntry('SCHEDULE_RESTORED', 'CANCELED', 'SCHEDULED', {}, at)],
  }
  const relinked = summary === null ? null : relinkedFiling(restored, summary, at, {})
  const next: FilingRecord = { ...(relinked ?? restored), version: filing.version + 1, updatedAt: at }
  return { filing: next, events: statusEvents(filing, next, at) }
}

/** 의무가 없어진 예정 신고 건을 배치가 취소합니다. */
export function decideScheduleCancel(filing: FilingRecord, at: string): FilingDecision {
  const next: FilingRecord = {
    ...filing,
    status: 'CANCELED',
    history: [...filing.history, systemEntry('SCHEDULE_CANCELED', filing.status, 'CANCELED', {}, at)],
    version: filing.version + 1,
    updatedAt: at,
  }
  return { filing: next, events: statusEvents(filing, next, at) }
}

function deadlinesOf(obligation: FilingObligation): Pick<FilingRecord, 'statutoryDue' | 'dueDate' | 'paymentDue'> {
  return { statutoryDue: obligation.statutoryDue, dueDate: obligation.dueDate, paymentDue: obligation.paymentDue }
}

function statusEvents(before: FilingRecord, after: FilingRecord, at: string): TaxEvent[] {
  return before.status === after.status ? [] : [filingStatusChanged(before, after, at)]
}

/**
 * 제출 자료 항목 하나를 고칩니다. 자동 연계 항목과 고객이 고칠 수 없는 상태는 막습니다. 제출 자료는 고객 몫이라 대리인이
 * 고치면 고객 대신 한 일(`onBehalfOf: 'CLIENT'`)로 남깁니다.
 */
function editRequirement(
  filing: FilingRecord,
  code: RequirementCode,
  change: (requirement: RequirementRecord) => Result.Result<RequirementRecord, RequirementEditRejection>,
  historyType: FilingHistoryRecord['type'],
  detail: FilingHistoryRecord['detail'],
  context: FilingDecisionContext,
): Result.Result<FilingDecision, RequirementEditRejection> {
  const requirement = filing.requirements.find((candidate) => candidate.code === code)
  if (requirement === undefined) return Result.fail(new RequirementNotFound({}))
  if (requirement.autoLinked) return Result.fail(new RequirementAutoLinked({}))
  if (!CLIENT_EDITABLE_STATUSES.includes(filing.status)) {
    return Result.fail(new FilingLocked({ currentStatus: filing.status }))
  }
  const changed = change(requirement)
  if (Result.isFailure(changed)) return Result.fail(changed.failure)
  const next: FilingRecord = {
    ...filing,
    requirements: filing.requirements.map((candidate) =>
      candidate.code === code
        ? { ...changed.success, updatedBy: context.actor.userId, updatedAt: context.at }
        : candidate,
    ),
    history: [
      ...filing.history,
      {
        type: historyType,
        actorKind: context.actor.kind,
        actorId: context.actor.userId,
        ...(context.actor.kind === 'AGENCY' ? { onBehalfOf: 'CLIENT' as const } : {}),
        fromStatus: null,
        toStatus: null,
        detail: { code, ...detail },
        occurredAt: context.at,
      },
    ],
    version: filing.version + 1,
    updatedAt: context.at,
  }
  return Result.succeed({ filing: next, events: [] })
}

/** 커맨드가 바꾸는 신고 건 값입니다. 상태·이력·버전은 `decideFilingCommand`가 맡습니다. */
function commandPatch(filing: FilingRecord, input: FilingCommandInput, at: string): Partial<FilingRecord> {
  switch (input.command) {
    case 'REQUEST':
      return { submitDue: input.submitDue }
    case 'REJECT':
      return { submitDue: input.submitDue }
    case 'UPLOAD_LEDGER':
      return {
        documents: attachDocument(filing.documents, { type: 'LEDGER', fileId: input.ledgerFileId }, at),
        ledgerUploadedAt: at,
        ledgerConfirmedAt: null,
      }
    case 'CONFIRM_LEDGER':
      return { ledgerConfirmedAt: at }
    case 'DISPUTE_LEDGER':
      return { ledgerDisputeCount: filing.ledgerDisputeCount + 1 }
    case 'FILE': {
      let documents = attachDocument(filing.documents, { type: 'RETURN', fileId: input.returnFileId }, at)
      if (input.paymentSlipFileId !== undefined) {
        documents = attachDocument(documents, { type: 'PAYMENT_SLIP', fileId: input.paymentSlipFileId }, at)
      }
      const hasSlip = documents.some((document) => document.type === 'PAYMENT_SLIP' && document.replacedAt === null)
      return {
        documents,
        payableAmount: input.payableAmount,
        paymentDue: input.paymentDue ?? filing.paymentDue ?? filing.dueDate,
        paymentSlipSentAt: hasSlip ? at : null,
      }
    }
    case 'RECORD_NOTICE':
      return {
        documents: attachDocument(filing.documents, { type: 'NOTICE', fileId: input.noticeFileId }, at),
        payableAmount: input.payableAmount,
        paymentDue: input.paymentDue,
        paymentSlipSentAt: at,
      }
    case 'PAY':
      return { settlement: 'PAID', paidOn: input.paidOn }
    case 'CLOSE':
      return { settlement: (filing.payableAmount ?? 0) < 0 ? 'REFUND' : 'NO_PAYMENT' }
    default:
      return {}
  }
}

function commandEntry(
  context: FilingDecisionContext,
  input: FilingCommandInput,
  from: FilingStatus,
  to: FilingStatus,
  onBehalfOf: 'CLIENT' | undefined,
): FilingHistoryRecord {
  const { command, ...rest } = input
  const detail = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  ) as FilingHistoryRecord['detail']
  return {
    type: command as FilingCommand,
    actorKind: context.actor.kind,
    actorId: context.actor.userId,
    ...(onBehalfOf === undefined ? {} : { onBehalfOf }),
    fromStatus: from,
    toStatus: to,
    detail,
    occurredAt: context.at,
  }
}

function systemEntry(
  type: FilingHistoryRecord['type'],
  fromStatus: FilingStatus | null,
  toStatus: FilingStatus | null,
  detail: Record<string, string | number>,
  at: string,
): FilingHistoryRecord {
  return { type, actorKind: 'SYSTEM', actorId: null, fromStatus, toStatus, detail, occurredAt: at }
}
