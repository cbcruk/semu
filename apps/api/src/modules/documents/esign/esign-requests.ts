import { createHash, randomBytes } from 'node:crypto'
import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { paginate, type PageOf, type PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { Violation } from '../../../shared/problem/problem.types.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { HrDirectory } from '../../hr/hr.public.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { CompanySealRepository } from '../seals/company-seal.ts'
import { DocumentEvents, DocumentNotifier } from '../shared/documents-ports.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import { EsignTemplateRepository, type EsignTemplateRecord } from '../templates/esign-template.ts'
import { allowedEsignActions, dueDateOnSend, isOverdue, transitionEsignRequest } from './esign-request-status.ts'
import type { EsignRequestEvent, EsignRequestStatus } from './esign-request-status.types.ts'
import { validateEsignSend } from './esign-send-validation.ts'
import {
  EsignRequestInvalid,
  EsignRequestNotFound,
  EsignRequestRepository,
  EsignRequestTransitionInvalid,
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

/** 저장한 요청에 기한 만료를 반영한 상태입니다. 만료는 기한 다음날부터입니다. */
export function effectiveStatus(record: EsignRequestRecord, today: string): EsignRequestStatus {
  return isOverdue(record.status, record.dueDate, today) ? 'EXPIRED' : record.status
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

      const transition = (record: EsignRequestRecord, today: string, event: EsignRequestEvent) => {
        const currentStatus = effectiveStatus(record, today)
        const result = transitionEsignRequest(currentStatus, event)
        return result.ok
          ? Effect.succeed(result.to)
          : Effect.fail(new EsignRequestTransitionInvalid({ currentStatus, command: event }))
      }

      const loadTemplates = (ids: ReadonlyArray<string>) =>
        Effect.forEach(ids, (id) => templates.find(id)).pipe(Effect.map((found) => found.map(Option.getOrUndefined)))

      /** 도장이 행위자 회사의 지우지 않은 도장인지 봅니다. 다른 회사 도장 ID는 없는 것과 같습니다. */
      const isOwnSeal = (actor: Actor, companySealId: string) =>
        Effect.map(seals.findActive(actor.companyId, companySealId), Option.isSome)

      /** 초안 내용을 검사하고 수신자의 빈 값을 인사 정보로 채웁니다. */
      const prepareDraft = Effect.fn('EsignRequests.prepareDraft')(function* (
        actor: Actor,
        draft: typeof EsignRequestDraft.Type,
        today: string,
      ) {
        const violations: Violation[] = []
        const found = yield* loadTemplates(draft.templateIds)
        found.forEach((template, index) => {
          if (template === undefined || template.kind.endsWith('_CERTIFICATE')) {
            violations.push({ field: `templateIds[${index}]`, code: 'NOT_FOUND' })
          }
        })
        const { employeeId } = draft.recipient
        const employee =
          employeeId === undefined
            ? undefined
            : Option.getOrUndefined(yield* directory.findEmployee(actor.companyId, employeeId, today))
        if (employeeId !== undefined && employee === undefined) {
          violations.push({ field: 'recipient.employeeId', code: 'NOT_FOUND' })
        }
        if (draft.companySealId !== undefined && !(yield* isOwnSeal(actor, draft.companySealId))) {
          violations.push({ field: 'companySealId', code: 'NOT_FOUND' })
        }
        const name = draft.recipient.name ?? employee?.name
        if (name === undefined || name.trim() === '') violations.push({ field: 'recipient.name', code: 'REQUIRED' })
        if (violations.length > 0 || name === undefined) return yield* new EsignRequestInvalid({ violations })
        return {
          title: draft.title,
          recipient: {
            employeeId,
            name,
            email: draft.recipient.email ?? employee?.email,
            phone: draft.recipient.phone ?? employee?.phone,
            isForeigner: draft.recipient.isForeigner ?? employee?.isForeigner ?? false,
            nationalityCode: draft.recipient.nationalityCode ?? employee?.nationalityCode,
            visaCode: draft.recipient.visaCode ?? employee?.visaCode,
          },
          templateIds: draft.templateIds,
          fieldValues: draft.fieldValues ?? {},
          hiddenFields: draft.hiddenFields ?? {},
          companySealId: draft.companySealId,
          dueDate: draft.dueDate,
        }
      })

      /** 발송 검증을 하고 링크를 만들어 보냅니다. 메일이 실패하면 `SEND_FAILED`로 남깁니다. */
      const deliver = Effect.fn('EsignRequests.deliver')(function* (
        actor: Actor,
        record: EsignRequestRecord,
        now: { iso: string; today: string },
      ) {
        const found = yield* loadTemplates(record.templateIds)
        const employee =
          record.recipient.employeeId === undefined
            ? undefined
            : Option.getOrUndefined(
                yield* directory.findEmployee(actor.companyId, record.recipient.employeeId, now.today),
              )
        const sourceValues: Record<string, unknown> =
          employee === undefined ? {} : { 'employee.name': employee.name, 'employee.joinDate': employee.joinDate }
        const check = validateEsignSend({
          recipient: record.recipient,
          documents: found.map((template: EsignTemplateRecord | undefined, index) => ({
            index,
            templateActive: template?.isActive ?? false,
            fields: template?.fields ?? [],
            defaultCompanySealId: template?.defaultCompanySealId,
          })),
          fieldValues: record.fieldValues,
          hiddenFields: record.hiddenFields,
          sourceValues,
          companySealId: record.companySealId,
        })
        // 템플릿 기본 도장이나 그새 지운 도장도 보낼 때 다시 확인합니다.
        if (check.companySealId !== undefined && !(yield* isOwnSeal(actor, check.companySealId))) {
          check.violations.push({ field: 'companySealId', code: 'NOT_FOUND' })
        }
        if (check.violations.length > 0) return yield* new EsignRequestInvalid({ violations: check.violations })
        const token = randomBytes(24).toString('base64url')
        const signingUrl = `${SIGNING_URL_BASE}${token}`
        const delivery = yield* notifier.sendSigningLink({
          companyId: actor.companyId,
          email: record.recipient.email ?? '',
          title: record.title,
          url: signingUrl,
        })
        const next: EsignRequestRecord = {
          ...record,
          status: delivery.ok ? 'PENDING' : 'SEND_FAILED',
          companySealId: check.companySealId as Id<'companySeal'> | undefined,
          dueDate: dueDateOnSend(
            record.dueDate !== undefined && record.dueDate >= now.today ? record.dueDate : undefined,
            now.today,
          ),
          sentAt: now.iso,
          linkTokenHash: hashToken(token),
          verifyFailures: 0,
          sessions: [],
          version: record.version + 1,
          updatedAt: now.iso,
        }
        yield* requests.save(next)
        if (delivery.ok) {
          yield* events.publish({
            type: 'esign_request.sent',
            companyId: actor.companyId,
            requestId: next.id,
            at: now.iso,
          })
        }
        return { ...toView(next, now.today), signingUrl }
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
          const prepared = yield* prepareDraft(actor, draft, now.today)
          const record: EsignRequestRecord = {
            id: newId('esignRequest'),
            companyId: actor.companyId,
            status: 'DRAFT',
            ...prepared,
            verifyFailures: 0,
            sessions: [],
            version: 1,
            createdAt: now.iso,
            updatedAt: now.iso,
          }
          yield* requests.save(record)
          return toView(record, now.today)
        }),

        update: Effect.fn('EsignRequests.update')(function* (actor, id, draft, expectedVersion) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          yield* transition(record, now.today, 'UPDATE')
          const prepared = yield* prepareDraft(actor, draft, now.today)
          const next: EsignRequestRecord = { ...record, ...prepared, version: record.version + 1, updatedAt: now.iso }
          yield* requests.save(next)
          return toView(next, now.today)
        }),

        remove: Effect.fn('EsignRequests.remove')(function* (actor, id) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* transition(record, now.today, 'DELETE')
          yield* requests.remove(actor.companyId, id)
        }),

        send: Effect.fn('EsignRequests.send')(function* (actor, id, command, expectedVersion) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          yield* transition(record, now.today, command)
          return yield* deliver(actor, record, now)
        }),

        apply: Effect.fn('EsignRequests.apply')(function* (actor, id, command, expectedVersion) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          const status = yield* transition(record, now.today, command)
          if (status === 'DELETED')
            return yield* new EsignRequestTransitionInvalid({ currentStatus: record.status, command })
          const next: EsignRequestRecord = {
            ...record,
            status,
            ...(command === 'REVERT_TO_DRAFT' ? { dueDate: undefined, sentAt: undefined } : {}),
            linkTokenHash: command === 'VOID' ? record.linkTokenHash : undefined,
            sessions: [],
            version: record.version + 1,
            updatedAt: now.iso,
          }
          yield* requests.save(next)
          return toView(next, now.today)
        }),
      })
    }),
  )
}
