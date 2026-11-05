import { Context, Effect, Layer, Option } from 'effect'
import { paginate } from '../../../shared/http/pagination.ts'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { lastDayOfMonth } from '../../../shared/time/calendar.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { ActionCards } from '../action-cards/action-cards.ts'
import { documentViewClosesReviewCard } from '../action-cards/action-card-rules.ts'
import { TaxEvents } from '../tax.public.ts'
import { currentInstant, descendingKey } from '../tax-time.ts'
import type { FilingCommand, FilingStatus, TaxType } from '../tax.types.ts'
import {
  FilingActorNotAllowed,
  FilingDocumentNotFound,
  FilingLocked,
  FilingNotFound,
  FilingRequirementsPending,
  FilingTransitionInvalid,
  RequirementAutoLinked,
  RequirementFileNotFound,
  RequirementHasFiles,
  RequirementNotFound,
} from './filing.ts'
import type { Filing, FilingSummary } from './filing.ts'
import type {
  FilingDocumentId,
  FilingDocumentRecord,
  FilingHistoryRecord,
  FilingRecord,
  RequirementRecord,
} from './filing.types.ts'
import { attachDocument, isDocumentVisibleToClient } from './filing-documents.ts'
import { FilingRepository } from './filing-repository.ts'
import { answerRequirement, payrollLedgerResponse, responseAfterFiles } from './filing-requirements.ts'
import type { RequirementAnswer, RequirementCode } from './filing-requirements.types.ts'
import { CLIENT_EDITABLE_STATUSES, transitionFiling } from './filing-status.ts'
import { filingStatusChanged, toFiling, toFilingSummary, transitionFacts } from './filing-view.ts'
import { PayrollLedgers } from './payroll-ledgers.ts'

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

/** 신고 건 목록 조건입니다. */
export interface FilingListQuery extends PageQuery {
  taxType?: TaxType
  status?: FilingStatus
  /** `true`면 끝나지 않은 신고 건만, `false`면 끝난 신고 건만입니다. 진행 현황(트래커)이 씁니다. */
  open?: boolean
}

/** 커맨드가 실패할 수 있는 오류입니다. */
export type FilingCommandError =
  FilingNotFound | FilingTransitionInvalid | FilingActorNotAllowed | FilingRequirementsPending | VersionMismatch

/** 제출 자료 쓰기가 실패할 수 있는 오류입니다. */
export type RequirementWriteError =
  | FilingNotFound
  | FilingLocked
  | RequirementNotFound
  | RequirementAutoLinked
  | RequirementHasFiles
  | RequirementFileNotFound

/** 끝난 상태입니다. 목록의 `open` 조건이 씁니다. */
export const CLOSED_STATUSES: ReadonlyArray<FilingStatus> = ['SETTLED', 'CANCELED']

/** 신고서·납부서를 붙이거나 바꿀 수 있는 상태입니다. */
const DOCUMENT_STATUSES: ReadonlyArray<FilingStatus> = ['PREPARING', 'FILED']

/** 세무 신고 건 작업입니다. 고객과 세무 대리인이 같은 신고 건을 다루고, 커맨드마다 할 수 있는 행위자가 정해져 있습니다. */
export class Filings extends Context.Service<
  Filings,
  {
    list(actor: Actor, query: FilingListQuery): Effect.Effect<PageOf<FilingSummary>>
    get(actor: Actor, id: Id<'filing'>): Effect.Effect<Filing, FilingNotFound>
    history(actor: Actor, id: Id<'filing'>): Effect.Effect<ReadonlyArray<FilingHistoryRecord>, FilingNotFound>
    /**
     * 커맨드를 적용하고 저장합니다. 저장할 때마다 `version`이 1 오릅니다.
     *
     * 같은 요청에서 할 일 카드를 열고 닫고, 상태가 바뀌면 `filing.status_changed`를 내보냅니다.
     */
    apply(
      actor: Actor,
      id: Id<'filing'>,
      input: FilingCommandInput,
      expectedVersion?: number,
    ): Effect.Effect<Filing, FilingCommandError>
    /** 고객이 항목에 해당 없음·미제출을 고르고 메모를 남깁니다. */
    answerRequirement(
      actor: Actor,
      id: Id<'filing'>,
      code: RequirementCode,
      answer: { response: RequirementAnswer; note?: string | null },
    ): Effect.Effect<Filing, RequirementWriteError>
    /** 파일 저장소에 올린 파일을 항목에 붙입니다. 항목은 `PROVIDED`가 됩니다. */
    attachRequirementFile(
      actor: Actor,
      id: Id<'filing'>,
      code: RequirementCode,
      fileId: Id<'file'>,
    ): Effect.Effect<Filing, RequirementWriteError>
    /** 항목에서 파일을 뗍니다. 마지막 파일이면 항목이 `PENDING`으로 돌아갑니다. */
    detachRequirementFile(
      actor: Actor,
      id: Id<'filing'>,
      code: RequirementCode,
      fileId: Id<'file'>,
    ): Effect.Effect<Filing, RequirementWriteError>
    /** 대리인이 신고서·납부서를 붙이거나 바꿉니다. 신고 뒤 납부서를 붙이면 `paymentSlipSentAt`을 남깁니다. */
    addDocument(
      actor: Actor,
      id: Id<'filing'>,
      document: { type: 'RETURN' | 'PAYMENT_SLIP'; fileId: Id<'file'> },
    ): Effect.Effect<Filing, FilingNotFound | FilingLocked | FilingActorNotAllowed>
    /**
     * 문서 하나를 엽니다. 고객이 처음 열면 열람 시각을 남기고, 신고서·고지서면 결과 확인 카드를 닫습니다.
     */
    viewDocument(
      actor: Actor,
      id: Id<'filing'>,
      documentId: FilingDocumentId,
    ): Effect.Effect<FilingDocumentRecord, FilingNotFound | FilingDocumentNotFound>
    /**
     * 급여대장 마감 변화를 원천세 `PAYROLL_LEDGER_CLOSED` 항목에 반영합니다. Payroll 이벤트를 받아 부릅니다.
     *
     * 그 지급월을 덮는, 취소되지 않은 원천세 신고 건만 봅니다.
     */
    syncPayrollLedger(companyId: Id<'company'>, paymentMonth: string): Effect.Effect<void>
  }
>()('semu/tax/Filings') {
  static readonly layer = Layer.effect(
    Filings,
    Effect.gen(function* () {
      const repository = yield* FilingRepository
      const cards = yield* ActionCards
      const events = yield* TaxEvents
      const payrollLedgers = yield* PayrollLedgers

      const find = (actor: Actor, id: Id<'filing'>) =>
        repository
          .findById(actor.companyId, id)
          .pipe(
            Effect.flatMap(Option.match({ onNone: () => Effect.fail(new FilingNotFound({})), onSome: Effect.succeed })),
          )

      const list = Effect.fn('Filings.list')(function* (actor: Actor, query: FilingListQuery) {
        const { today } = yield* currentInstant
        const filings = yield* repository.list(actor.companyId, {
          ...(query.taxType === undefined ? {} : { taxTypes: [query.taxType] }),
          ...(query.status === undefined ? {} : { statuses: [query.status] }),
        })
        const selected = filings
          .filter((filing) => query.open === undefined || query.open !== CLOSED_STATUSES.includes(filing.status))
          .toSorted((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.id.localeCompare(a.id))
        const page = paginate(
          selected,
          (filing) => `${descendingKey(filing.periodEnd)}|${descendingKey(filing.id)}`,
          query,
        )
        return { ...page, items: page.items.map((filing) => toFilingSummary(filing, today)) }
      })

      const get = Effect.fn('Filings.get')(function* (actor: Actor, id: Id<'filing'>) {
        const filing = yield* find(actor, id)
        const { today } = yield* currentInstant
        return toFiling(filing, actor.kind, today)
      })

      const history = Effect.fn('Filings.history')(function* (actor: Actor, id: Id<'filing'>) {
        const filing = yield* find(actor, id)
        return filing.history
      })

      const apply = Effect.fn('Filings.apply')(function* (
        actor: Actor,
        id: Id<'filing'>,
        input: FilingCommandInput,
        expectedVersion?: number,
      ) {
        const filing = yield* find(actor, id)
        yield* checkVersion(filing.version, expectedVersion)
        const result = transitionFiling(filing.status, input.command, actor.kind, transitionFacts(filing))
        if (!result.ok) {
          switch (result.code) {
            case 'FILING_ACTOR_NOT_ALLOWED':
              return yield* new FilingActorNotAllowed({
                action: input.command,
                requiredActorKind: result.requiredActor!,
              })
            case 'FILING_REQUIREMENTS_PENDING':
              return yield* new FilingRequirementsPending({
                requirementCodes: transitionFacts(filing).pendingRequirementCodes as RequirementCode[],
              })
            case 'FILING_TRANSITION_INVALID':
              return yield* new FilingTransitionInvalid({ currentStatus: filing.status, command: input.command })
          }
        }

        const { now, today } = yield* currentInstant
        const next: FilingRecord = {
          ...filing,
          ...commandPatch(filing, input, now),
          status: result.to,
          history: [...filing.history, historyEntry(actor, input, filing.status, result.to, now)],
          version: filing.version + 1,
          updatedAt: now,
        }
        yield* repository.save(next)
        yield* cards.applyFilingTrigger(next, input.command, now)
        if (filing.status !== next.status) yield* events.publish([filingStatusChanged(filing, next, now)])
        return toFiling(next, actor.kind, today)
      })

      const editRequirement = Effect.fn('Filings.editRequirement')(function* (
        actor: Actor,
        id: Id<'filing'>,
        code: RequirementCode,
        change: (requirement: RequirementRecord) => Effect.Effect<RequirementRecord, RequirementWriteError>,
        historyType: FilingHistoryRecord['type'],
        detail: FilingHistoryRecord['detail'],
      ) {
        const filing = yield* find(actor, id)
        const requirement = filing.requirements.find((candidate) => candidate.code === code)
        if (requirement === undefined) return yield* new RequirementNotFound({})
        if (requirement.autoLinked) return yield* new RequirementAutoLinked({})
        if (!CLIENT_EDITABLE_STATUSES.includes(filing.status))
          return yield* new FilingLocked({ currentStatus: filing.status })

        const { now, today } = yield* currentInstant
        const changed = yield* change(requirement)
        const next: FilingRecord = {
          ...filing,
          requirements: filing.requirements.map((candidate) =>
            candidate.code === code ? { ...changed, updatedBy: actor.userId, updatedAt: now } : candidate,
          ),
          history: [
            ...filing.history,
            {
              type: historyType,
              actorKind: actor.kind,
              actorId: actor.userId,
              fromStatus: null,
              toStatus: null,
              detail: { code, ...detail },
              occurredAt: now,
            },
          ],
          version: filing.version + 1,
          updatedAt: now,
        }
        yield* repository.save(next)
        return toFiling(next, actor.kind, today)
      })

      const answer = (
        actor: Actor,
        id: Id<'filing'>,
        code: RequirementCode,
        input: { response: RequirementAnswer; note?: string | null },
      ) =>
        editRequirement(
          actor,
          id,
          code,
          (requirement) => {
            const result = answerRequirement(
              { autoLinked: false, fileCount: requirement.fileIds.length },
              input.response,
            )
            if (!result.ok) return Effect.fail(new RequirementHasFiles({}))
            return Effect.succeed({
              ...requirement,
              response: result.response,
              ...(input.note === undefined ? {} : { note: input.note }),
            })
          },
          'REQUIREMENT_ANSWERED',
          { response: input.response },
        )

      const attachRequirementFile = (actor: Actor, id: Id<'filing'>, code: RequirementCode, fileId: Id<'file'>) =>
        editRequirement(
          actor,
          id,
          code,
          (requirement) => {
            const fileIds = requirement.fileIds.includes(fileId)
              ? requirement.fileIds
              : [...requirement.fileIds, fileId]
            return Effect.succeed({ ...requirement, fileIds, response: responseAfterFiles(fileIds.length) })
          },
          'REQUIREMENT_FILE_ADDED',
          { fileId },
        )

      const detachRequirementFile = (actor: Actor, id: Id<'filing'>, code: RequirementCode, fileId: Id<'file'>) =>
        editRequirement(
          actor,
          id,
          code,
          (requirement) => {
            if (!requirement.fileIds.includes(fileId)) return Effect.fail(new RequirementFileNotFound({}))
            const fileIds = requirement.fileIds.filter((candidate) => candidate !== fileId)
            return Effect.succeed({ ...requirement, fileIds, response: responseAfterFiles(fileIds.length) })
          },
          'REQUIREMENT_FILE_REMOVED',
          { fileId },
        )

      const addDocument = Effect.fn('Filings.addDocument')(function* (
        actor: Actor,
        id: Id<'filing'>,
        document: { type: 'RETURN' | 'PAYMENT_SLIP'; fileId: Id<'file'> },
      ) {
        const filing = yield* find(actor, id)
        if (actor.kind !== 'AGENCY') {
          return yield* new FilingActorNotAllowed({ action: 'ADD_DOCUMENT', requiredActorKind: 'AGENCY' })
        }
        if (!DOCUMENT_STATUSES.includes(filing.status)) return yield* new FilingLocked({ currentStatus: filing.status })
        const { now, today } = yield* currentInstant
        const next: FilingRecord = {
          ...filing,
          documents: attachDocument(filing.documents, document, now),
          ...(document.type === 'PAYMENT_SLIP' && filing.status === 'FILED' ? { paymentSlipSentAt: now } : {}),
          history: [
            ...filing.history,
            {
              type: 'DOCUMENT_ADDED',
              actorKind: actor.kind,
              actorId: actor.userId,
              fromStatus: null,
              toStatus: null,
              detail: { ...document },
              occurredAt: now,
            },
          ],
          version: filing.version + 1,
          updatedAt: now,
        }
        yield* repository.save(next)
        return toFiling(next, actor.kind, today)
      })

      const viewDocument = Effect.fn('Filings.viewDocument')(function* (
        actor: Actor,
        id: Id<'filing'>,
        documentId: FilingDocumentId,
      ) {
        const filing = yield* find(actor, id)
        const document = filing.documents.find((candidate) => candidate.id === documentId)
        if (
          document === undefined ||
          (actor.kind === 'CLIENT' && !isDocumentVisibleToClient(document, filing.status))
        ) {
          return yield* new FilingDocumentNotFound({})
        }
        if (actor.kind !== 'CLIENT' || document.firstViewedAt !== null) return document

        const { now } = yield* currentInstant
        const viewed = { ...document, firstViewedAt: now }
        yield* repository.save({
          ...filing,
          documents: filing.documents.map((candidate) => (candidate.id === documentId ? viewed : candidate)),
        })
        if (documentViewClosesReviewCard(document.type, actor.kind)) {
          yield* cards.closeFilingCard(filing, 'REVIEW_FILING_RESULT', now)
        }
        return viewed
      })

      const syncPayrollLedger = Effect.fn('Filings.syncPayrollLedger')(function* (
        companyId: Id<'company'>,
        paymentMonth: string,
      ) {
        const filings = yield* repository.list(companyId, {
          taxTypes: ['WITHHOLDING_TAX'],
          covering: `${paymentMonth}-01`,
        })
        const { now } = yield* currentInstant
        for (const filing of filings) {
          if (filing.status === 'CANCELED') continue
          const linked = filing.requirements.find((requirement) => requirement.code === 'PAYROLL_LEDGER_CLOSED')
          if (linked === undefined) continue
          const summary = yield* payrollLedgers.summaryFor(companyId, filing.periodStart, filing.periodEnd)
          const response = payrollLedgerResponse(summary)
          if (response === linked.response) continue
          yield* repository.save({
            ...filing,
            requirements: filing.requirements.map((requirement) =>
              requirement === linked ? { ...requirement, response, updatedAt: now } : requirement,
            ),
            history: [
              ...filing.history,
              {
                type: 'REQUIREMENT_LINKED',
                actorKind: 'SYSTEM',
                actorId: null,
                fromStatus: null,
                toStatus: null,
                detail: { code: linked.code, response, paymentMonth, lastDay: lastDayOfMonth(paymentMonth) },
                occurredAt: now,
              },
            ],
            version: filing.version + 1,
            updatedAt: now,
          })
        }
      })

      return Filings.of({
        list,
        get,
        history,
        apply,
        answerRequirement: answer,
        attachRequirementFile,
        detachRequirementFile,
        addDocument,
        viewDocument,
        syncPayrollLedger,
      })
    }),
  )
}

/** 커맨드가 바꾸는 신고 건 값입니다. 상태·이력·버전은 `apply`가 맡습니다. */
function commandPatch(filing: FilingRecord, input: FilingCommandInput, now: string): Partial<FilingRecord> {
  switch (input.command) {
    case 'REQUEST':
      return { submitDue: input.submitDue }
    case 'REJECT':
      return { submitDue: input.submitDue }
    case 'UPLOAD_LEDGER':
      return {
        documents: attachDocument(filing.documents, { type: 'LEDGER', fileId: input.ledgerFileId }, now),
        ledgerUploadedAt: now,
        ledgerConfirmedAt: null,
      }
    case 'CONFIRM_LEDGER':
      return { ledgerConfirmedAt: now }
    case 'DISPUTE_LEDGER':
      return { ledgerDisputeCount: filing.ledgerDisputeCount + 1 }
    case 'FILE': {
      let documents = attachDocument(filing.documents, { type: 'RETURN', fileId: input.returnFileId }, now)
      if (input.paymentSlipFileId !== undefined) {
        documents = attachDocument(documents, { type: 'PAYMENT_SLIP', fileId: input.paymentSlipFileId }, now)
      }
      const hasSlip = documents.some((document) => document.type === 'PAYMENT_SLIP' && document.replacedAt === null)
      return {
        documents,
        payableAmount: input.payableAmount,
        paymentDue: input.paymentDue ?? filing.paymentDue ?? filing.dueDate,
        paymentSlipSentAt: hasSlip ? now : null,
      }
    }
    case 'RECORD_NOTICE':
      return {
        documents: attachDocument(filing.documents, { type: 'NOTICE', fileId: input.noticeFileId }, now),
        payableAmount: input.payableAmount,
        paymentDue: input.paymentDue,
        paymentSlipSentAt: now,
      }
    case 'PAY':
      return { settlement: 'PAID', paidOn: input.paidOn }
    case 'CLOSE':
      return { settlement: (filing.payableAmount ?? 0) < 0 ? 'REFUND' : 'NO_PAYMENT' }
    default:
      return {}
  }
}

function historyEntry(
  actor: Actor,
  input: FilingCommandInput,
  from: FilingStatus,
  to: FilingStatus,
  now: string,
): FilingHistoryRecord {
  const { command, ...rest } = input
  const detail = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  ) as FilingHistoryRecord['detail']
  return {
    type: command as FilingCommand,
    actorKind: actor.kind,
    actorId: actor.userId,
    fromStatus: from,
    toStatus: to,
    detail,
    occurredAt: now,
  }
}
