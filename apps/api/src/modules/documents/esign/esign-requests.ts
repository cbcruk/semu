import { createHash, randomBytes } from 'node:crypto'
import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { paginate, type PageOf, type PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { HrDirectory } from '../../hr/hr.public.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { CompanySealRepository } from '../seals/company-seal.ts'
import { DocumentEvents, DocumentNotifier } from '../shared/documents-ports.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import { EsignTemplateRepository } from '../templates/esign-template.ts'
import {
  decideEsignRequestCommand,
  decideEsignRequestCreation,
  decideEsignRequestRemoval,
  decideEsignRequestSend,
  decideEsignRequestUpdate,
  decideExpire,
  effectiveStatus,
  planEsignRequestSend,
  type EsignRequestDecision,
} from './esign-request.aggregate.ts'
import { allowedEsignActions } from './esign-request-status.ts'
import type { EsignRequestStatus } from './esign-request-status.types.ts'
import {
  EsignRequestNotFound,
  EsignRequestRepository,
  type EsignRequestInvalid,
  type EsignRequestTransitionInvalid,
  type EsignRequest,
  type EsignRequestDraft,
  type EsignRequestRecord,
} from './esign-request.ts'

/** 서명 링크의 주소입니다. 토큰만 바뀝니다. */
export const SIGNING_URL_BASE = 'https://app.semu.kr/esign/'

/** 발송 응답입니다. 링크 복사를 위해 서명 주소를 이번 응답에만 담습니다. */
export type SentEsignRequest = EsignRequest & { signingUrl: string }

/** 목록 조건입니다. */
export interface EsignRequestFilter extends PageQuery {
  status?: EsignRequestStatus
}

type CommandError = EsignRequestNotFound | EsignRequestTransitionInvalid | VersionMismatch

/** 링크 토큰과 세션 토큰은 SHA-256 해시로만 저장합니다. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 관리자의 전자서명 요청 관리입니다. 서명자 쪽은 `Signing`이 맡습니다. */
export class EsignRequests extends Context.Service<
  EsignRequests,
  {
    list(actor: Actor, filter: EsignRequestFilter): Effect.Effect<PageOf<EsignRequest>>
    get(actor: Actor, id: Id<'esignRequest'>): Effect.Effect<EsignRequest, EsignRequestNotFound>
    create(actor: Actor, draft: typeof EsignRequestDraft.Type): Effect.Effect<EsignRequest, EsignRequestInvalid>
    update(
      actor: Actor,
      id: Id<'esignRequest'>,
      draft: typeof EsignRequestDraft.Type,
      expectedVersion: number | undefined,
    ): Effect.Effect<EsignRequest, CommandError | EsignRequestInvalid>
    remove(
      actor: Actor,
      id: Id<'esignRequest'>,
    ): Effect.Effect<void, EsignRequestNotFound | EsignRequestTransitionInvalid>
    send(
      actor: Actor,
      id: Id<'esignRequest'>,
      command: 'SEND' | 'RESEND',
      expectedVersion: number | undefined,
    ): Effect.Effect<SentEsignRequest, CommandError | EsignRequestInvalid>
    apply(
      actor: Actor,
      id: Id<'esignRequest'>,
      command: 'REVERT_TO_DRAFT' | 'CANCEL' | 'VOID',
      expectedVersion: number | undefined,
    ): Effect.Effect<EsignRequest, CommandError>
    /**
     * 시스템 커맨드입니다. 회사의 서명 대기·진행 중 요청 중 기한(`dueDate`)이 지난 것을 `EXPIRED`로 바꾸고 `esign_request.expired`를
     * 냅니다. 바꾼 건수를 돌려줍니다. 같은 날 다시 불러도 바꿀 것이 없습니다.
     */
    expireOverdue(companyId: Id<'company'>): Effect.Effect<number>
  }
>()('semu/documents/EsignRequests') {
  static readonly layer = Layer.effect(
    EsignRequests,
    Effect.gen(function* () {
      const requests = yield* EsignRequestRepository
      const templates = yield* EsignTemplateRepository
      const seals = yield* CompanySealRepository
      const directory = yield* HrDirectory
      const notifier = yield* DocumentNotifier
      const events = yield* DocumentEvents

      const clock = DateTime.now.pipe(
        Effect.map((now) => ({ iso: DateTime.formatIso(now), today: companyDate(DateTime.toEpochMillis(now)) })),
      )

      const toView = (record: EsignRequestRecord, today: string): EsignRequest => {
        const {
          companyId: _company,
          linkTokenHash: _link,
          verifyFailures: _failures,
          sessions: _sessions,
          recipient,
          ...rest
        } = record
        const status = effectiveStatus(record, today)
        return {
          ...stripUndefined(rest),
          recipient: stripUndefined(recipient),
          status,
          allowedActions: allowedEsignActions(status),
        }
      }

      const find = (actor: Actor, id: Id<'esignRequest'>) =>
        requests
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new EsignRequestNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const save = (decision: EsignRequestDecision) =>
        Effect.gen(function* () {
          yield* requests.save(decision.request)
          for (const event of decision.events) yield* events.publish(event)
        })

      const loadTemplates = (ids: ReadonlyArray<string>) =>
        Effect.forEach(ids, (id) => templates.find(id)).pipe(Effect.map((found) => found.map(Option.getOrUndefined)))

      /** 회사의 지우지 않은 도장 ID입니다. */
      const activeSealIds = (actor: Actor) =>
        Effect.map(
          seals.list(actor.companyId),
          (all) => new Set<string>(all.filter((seal) => seal.deletedAt === undefined).map((seal) => seal.id)),
        )

      const findEmployee = (actor: Actor, employeeId: Id<'employee'> | undefined, today: string) =>
        employeeId === undefined
          ? Effect.succeed(undefined)
          : Effect.map(directory.findEmployee(actor.companyId, employeeId, today), Option.getOrUndefined)

      /** 초안 판정에 필요한 템플릿·직원·도장을 읽습니다. */
      const draftFacts = Effect.fn('EsignRequests.draftFacts')(function* (
        actor: Actor,
        draft: typeof EsignRequestDraft.Type,
        today: string,
      ) {
        return {
          templates: yield* loadTemplates(draft.templateIds),
          employee: yield* findEmployee(actor, draft.recipient.employeeId, today),
          activeSealIds: yield* activeSealIds(actor),
        }
      })

      return EsignRequests.of({
        list: Effect.fn('EsignRequests.list')(function* (actor, filter) {
          const { today } = yield* clock
          const views = (yield* requests.list(actor.companyId))
            .map((record) => toView(record, today))
            .filter((view) => filter.status === undefined || view.status === filter.status)
          return paginate(views, (view) => view.id, filter, { includeTotal: true })
        }),

        get: (actor, id) =>
          Effect.all([find(actor, id), clock]).pipe(Effect.map(([record, now]) => toView(record, now.today))),

        create: Effect.fn('EsignRequests.create')(function* (actor, draft) {
          const now = yield* clock
          const decision = yield* Effect.fromResult(
            decideEsignRequestCreation(
              { id: newId('esignRequest'), companyId: actor.companyId },
              draft,
              yield* draftFacts(actor, draft, now.today),
              now,
            ),
          )
          yield* save(decision)
          return toView(decision.request, now.today)
        }),

        update: Effect.fn('EsignRequests.update')(function* (actor, id, draft, expectedVersion) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          const decision = yield* Effect.fromResult(
            decideEsignRequestUpdate(record, draft, yield* draftFacts(actor, draft, now.today), now),
          )
          yield* save(decision)
          return toView(decision.request, now.today)
        }),

        remove: Effect.fn('EsignRequests.remove')(function* (actor, id) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* Effect.fromResult(decideEsignRequestRemoval(record, now.today))
          yield* requests.remove(actor.companyId, id)
        }),

        send: Effect.fn('EsignRequests.send')(function* (actor, id, command, expectedVersion) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          const plan = yield* Effect.fromResult(
            planEsignRequestSend(
              record,
              command,
              {
                templates: yield* loadTemplates(record.templateIds),
                employee: yield* findEmployee(actor, record.recipient.employeeId, now.today),
                activeSealIds: yield* activeSealIds(actor),
              },
              now.today,
            ),
          )
          const token = randomBytes(24).toString('base64url')
          const signingUrl = `${SIGNING_URL_BASE}${token}`
          const delivery = yield* notifier.sendSigningLink({
            companyId: actor.companyId,
            email: record.recipient.email ?? '',
            title: record.title,
            url: signingUrl,
          })
          const decision = decideEsignRequestSend(
            record,
            plan,
            { delivered: delivery.ok, linkTokenHash: hashToken(token) },
            now,
          )
          yield* save(decision)
          return { ...toView(decision.request, now.today), signingUrl }
        }),

        apply: Effect.fn('EsignRequests.apply')(function* (actor, id, command, expectedVersion) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          const decision = yield* Effect.fromResult(decideEsignRequestCommand(record, command, now))
          yield* save(decision)
          return toView(decision.request, now.today)
        }),

        expireOverdue: Effect.fn('EsignRequests.expireOverdue')(function* (companyId) {
          const now = yield* clock
          let expired = 0
          for (const record of yield* requests.list(companyId)) {
            const decision = decideExpire(record, now.today, now.iso)
            if (decision === null) continue
            yield* save(decision)
            expired += 1
          }
          return expired
        }),
      })
    }),
  )
}
