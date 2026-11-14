import { Context, Effect, Layer, Option } from 'effect'
import type { Result } from 'effect'
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
import type { FilingStatus, TaxType } from '../tax.types.ts'
import type {
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
import { FilingNotFound } from './filing.ts'
import type { Filing, FilingSummary } from './filing.ts'
import {
  decideDocumentAdd,
  decideDocumentView,
  decideFilingCommand,
  decidePayrollLedgerRelink,
  decideRequirementAnswer,
  decideRequirementFileAttach,
  decideRequirementFileDetach,
  hasAutoLinkedRequirements,
} from './filing.aggregate.ts'
import type { FilingCommandInput, FilingDecision, FilingDecisionContext } from './filing.aggregate.ts'
import type { FilingDocumentId, FilingDocumentRecord, FilingHistoryRecord, FilingRecord } from './filing.types.ts'
import { FilingRepository } from './filing-repository.ts'
import type { RequirementAnswer, RequirementCode } from './filing-requirements.types.ts'
import { toFiling, toFilingSummary } from './filing-view.ts'
import { PayrollLedgers } from './payroll-ledgers.ts'
import { monthsBetween, withholdingReturnLines } from './withholding-return.ts'
import type { WithholdingReturnMonth } from './withholding-return.types.ts'
import { WithholdingTotals } from './withholding-totals.ts'

export type { FilingCommandInput } from './filing.aggregate.ts'

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

/** 세무 신고 건 작업입니다. 고객과 세무 대리인이 같은 신고 건을 다루고, 커맨드마다 할 수 있는 행위자가 정해져 있습니다. */
export class Filings extends Context.Service<
  Filings,
  {
    list(actor: Actor, query: FilingListQuery): Effect.Effect<PageOf<FilingSummary>>
    get(actor: Actor, id: Id<'filing'>): Effect.Effect<Filing, FilingNotFound>
    history(actor: Actor, id: Id<'filing'>): Effect.Effect<ReadonlyArray<FilingHistoryRecord>, FilingNotFound>
    /**
     * 원천세 신고 건 기간의 지급월마다 Payroll의 원천세 합계(`WithholdingTotals`)에 신고서 줄 코드를 붙여 돌려줍니다.
     *
     * 그 달 급여대장의 마감 현황(`PayrollLedgers`)도 함께 넣습니다. 원천세가 아닌 신고 건은 비어 있습니다.
     */
    withholdingLines(
      actor: Actor,
      id: Id<'filing'>,
    ): Effect.Effect<ReadonlyArray<WithholdingReturnMonth>, FilingNotFound>
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
      const withholdingTotals = yield* WithholdingTotals

      const find = (actor: Actor, id: Id<'filing'>) =>
        repository
          .findById(actor.companyId, id)
          .pipe(
            Effect.flatMap(Option.match({ onNone: () => Effect.fail(new FilingNotFound({})), onSome: Effect.succeed })),
          )

      /** 판정 결과를 저장하고, 그 변경이 낸 이벤트를 같은 트랜잭션에 냅니다. */
      const save = (decision: FilingDecision) =>
        Effect.gen(function* () {
          yield* repository.save(decision.filing)
          if (decision.events.length > 0) yield* events.publish(decision.events)
        })

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

      const withholdingLines = Effect.fn('Filings.withholdingLines')(function* (actor: Actor, id: Id<'filing'>) {
        const filing = yield* find(actor, id)
        if (filing.taxType !== 'WITHHOLDING_TAX') return []
        return yield* Effect.forEach(monthsBetween(filing.periodStart, filing.periodEnd), (paymentMonth) =>
          Effect.gen(function* () {
            const ledgers = yield* payrollLedgers.summaryFor(
              actor.companyId,
              `${paymentMonth}-01`,
              lastDayOfMonth(paymentMonth),
            )
            const totals = yield* withholdingTotals.totalsFor(actor.companyId, paymentMonth)
            return { paymentMonth, ...ledgers, lines: withholdingReturnLines(totals) }
          }),
        )
      })

      const apply = Effect.fn('Filings.apply')(function* (
        actor: Actor,
        id: Id<'filing'>,
        input: FilingCommandInput,
        expectedVersion?: number,
      ) {
        const filing = yield* find(actor, id)
        yield* checkVersion(filing.version, expectedVersion)
        const { today, context } = yield* decisionContext(actor)
        const decision = yield* Effect.fromResult(decideFilingCommand(filing, input, context))
        yield* save(decision)
        yield* cards.applyFilingTrigger(decision.filing, input.command, context.at)
        return toFiling(decision.filing, actor.kind, today)
      })

      const editRequirement = Effect.fn('Filings.editRequirement')(function* (
        actor: Actor,
        id: Id<'filing'>,
        decide: (
          filing: FilingRecord,
          context: FilingDecisionContext,
        ) => Result.Result<FilingDecision, RequirementWriteError>,
      ) {
        const filing = yield* find(actor, id)
        const { today, context } = yield* decisionContext(actor)
        const decision = yield* Effect.fromResult(decide(filing, context))
        yield* save(decision)
        return toFiling(decision.filing, actor.kind, today)
      })

      const answer = (
        actor: Actor,
        id: Id<'filing'>,
        code: RequirementCode,
        input: { response: RequirementAnswer; note?: string | null },
      ) => editRequirement(actor, id, (filing, context) => decideRequirementAnswer(filing, code, input, context))

      const attachRequirementFile = (actor: Actor, id: Id<'filing'>, code: RequirementCode, fileId: Id<'file'>) =>
        editRequirement(actor, id, (filing, context) => decideRequirementFileAttach(filing, code, fileId, context))

      const detachRequirementFile = (actor: Actor, id: Id<'filing'>, code: RequirementCode, fileId: Id<'file'>) =>
        editRequirement(actor, id, (filing, context) => decideRequirementFileDetach(filing, code, fileId, context))

      const addDocument = Effect.fn('Filings.addDocument')(function* (
        actor: Actor,
        id: Id<'filing'>,
        document: { type: 'RETURN' | 'PAYMENT_SLIP'; fileId: Id<'file'> },
      ) {
        const filing = yield* find(actor, id)
        const { today, context } = yield* decisionContext(actor)
        const decision = yield* Effect.fromResult(decideDocumentAdd(filing, document, context))
        yield* save(decision)
        return toFiling(decision.filing, actor.kind, today)
      })

      const viewDocument = Effect.fn('Filings.viewDocument')(function* (
        actor: Actor,
        id: Id<'filing'>,
        documentId: FilingDocumentId,
      ) {
        const filing = yield* find(actor, id)
        const { context } = yield* decisionContext(actor)
        const decision = yield* Effect.fromResult(decideDocumentView(filing, documentId, context))
        if (decision.filing === null) return decision.document
        yield* repository.save(decision.filing)
        if (documentViewClosesReviewCard(decision.document.type, actor.kind)) {
          yield* cards.closeFilingCard(filing, 'REVIEW_FILING_RESULT', context.at)
        }
        return decision.document
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
          if (filing.status === 'CANCELED' || !hasAutoLinkedRequirements(filing)) continue
          const summary = yield* payrollLedgers.summaryFor(companyId, filing.periodStart, filing.periodEnd)
          const decision = decidePayrollLedgerRelink(filing, summary, now, {
            paymentMonth,
            lastDay: lastDayOfMonth(paymentMonth),
          })
          if (decision !== null) yield* save(decision)
        }
      })

      return Filings.of({
        list,
        get,
        history,
        withholdingLines,
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

/** 요청의 행위자와 지금 시각으로 판정 문맥을 만듭니다. 오늘(`today`)은 응답의 파생 필드에 씁니다. */
const decisionContext = (actor: Actor) =>
  Effect.map(currentInstant, ({ now, today }) => ({
    today,
    context: { at: now, actor: { kind: actor.kind, userId: actor.userId } } satisfies FilingDecisionContext,
  }))
