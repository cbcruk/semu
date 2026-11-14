import { Clock, Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { DelegationRepository, hasAgreedDelegation } from '../hometax-delegations/hometax-delegation.ts'
import { INSTITUTION_TYPES } from '../institutions/institution.ts'
import type { InstitutionType } from '../institutions/institution.ts'
import { IntegrationRepository } from '../integrations/integration-repository.ts'
import { IntegrationItemNotFound, IntegrationNotFound } from '../integrations/integration.ts'
import { isPausedForSchedule } from '../integrations/scrap-retry.ts'
import {
  effectiveJobStatus,
  SCRAP_COOLDOWN_SECONDS,
  SCRAP_TIMEOUT_SECONDS,
  scrapAvailability,
} from './scrap-cooldown.ts'
import type { ScrapAvailability } from './scrap-cooldown.ts'
import { ScrapRequestRepository } from './scrap-request-repository.ts'
import {
  HometaxDelegationRequired,
  InstitutionNotConnected,
  ScrapRequestNotFound,
  ScrapRequestTooSoon,
} from './scrap-request.ts'
import type { ScrapRequest, ScrapRequestInput, ScrapRequestRecord } from './scrap-request.ts'
import { ScrapQueue } from './scrap-worker.ts'

/** 기관별 수동 수집 가능 여부입니다. */
export interface ScrapAvailabilityView {
  institutionType: InstitutionType
  isConnected: boolean
  canRequest: boolean
  reason?: 'RUNNING' | 'COOLDOWN' | 'NOT_CONNECTED' | 'DELEGATION_REQUIRED'
  retryAfterSeconds?: number
  latestRequestId?: Id<'scrapRequest'>
}

/** 전체 수집 결과입니다. */
export interface ScrapAllView {
  items: ScrapRequest[]
  skipped: Array<
    | { institutionType: InstitutionType; reason: 'RUNNING' | 'COOLDOWN'; retryAfterSeconds: number }
    | { institutionType: InstitutionType; reason: 'DELEGATION_REQUIRED' }
  >
}

const iso = (millis: number): string => new Date(millis).toISOString()

/** 저장한 수집 요청을 응답 형태로 바꿉니다. 타임아웃이 지난 미완료 요청은 `FAILED`로 보입니다. */
export function scrapRequestView(record: ScrapRequestRecord, now: number): ScrapRequest {
  const status = effectiveJobStatus(record.status, record.timeoutAt, now)
  const timedOut = status !== record.status
  return {
    id: record.id,
    institutionType: record.institutionType,
    ...(record.integrationId === undefined ? {} : { integrationId: record.integrationId }),
    ...(record.itemKey === undefined ? {} : { itemKey: record.itemKey }),
    requester: record.requester,
    status,
    isInitial: record.isInitial,
    ...(record.options === undefined ? {} : { options: record.options }),
    ...(record.results === undefined ? {} : { result: { items: record.results } }),
    ...(timedOut ? { error: { code: 'SCRAP_TIMEOUT', title: 'Institution did not respond in time' } } : {}),
    createdAt: iso(record.createdAt),
    ...(record.startedAt === undefined ? {} : { startedAt: iso(record.startedAt) }),
    ...(record.finishedAt === undefined ? {} : { finishedAt: iso(record.finishedAt) }),
    timeoutAt: iso(record.timeoutAt),
    ...(record.nextAvailableAt === undefined ? {} : { nextAvailableAt: iso(record.nextAvailableAt) }),
  }
}

function availabilityOf(latest: Option.Option<ScrapRequestRecord>, now: number): ScrapAvailability {
  return scrapAvailability(
    Option.getOrUndefined(
      Option.map(latest, (found) => ({
        requester: found.requester,
        status: found.status,
        timeoutAt: found.timeoutAt,
        ...(found.nextAvailableAt === undefined ? {} : { nextAvailableAt: found.nextAvailableAt }),
      })),
    ),
    now,
  )
}

/**
 * 수동 수집 요청입니다. 쿨다운을 확인하고 `Job`을 만들어 큐에 넣습니다. 권한 확인은 핸들러가 합니다.
 *
 * 같은 `Idempotency-Key`로 다시 오면 처음 만든 요청을 돌려줍니다.
 *
 * 홈택스는 수임동의를 봅니다(docs/design/compliance.md). 세무대리인(`AGENCY`)의 수동 요청과 정기 수집은 동의한 수임이 있어야 하고,
 * 회사 사용자(`CLIENT`)는 자기 자격 증명으로 수임 없이도 수집합니다.
 */
export class ScrapRequests extends Context.Service<
  ScrapRequests,
  {
    request(
      actor: Actor,
      input: ScrapRequestInput,
      idempotencyKey: string,
    ): Effect.Effect<
      ScrapRequest,
      | InstitutionNotConnected
      | ScrapRequestTooSoon
      | IntegrationNotFound
      | IntegrationItemNotFound
      | HometaxDelegationRequired
    >
    requestAll(actor: Actor, idempotencyKey: string): Effect.Effect<ScrapAllView>
    get(actor: Actor, requestId: Id<'scrapRequest'>): Effect.Effect<ScrapRequest, ScrapRequestNotFound>
    list(actor: Actor, type?: InstitutionType): Effect.Effect<ScrapRequest[]>
    availability(actor: Actor): Effect.Effect<ScrapAvailabilityView[]>
    /**
     * 정기 수집(시스템 요청)입니다. 정기 작업이 슬롯마다 부릅니다. 행위자·권한 검사가 없고 쿨다운을 남기지 않습니다.
     *
     * - 그 기관 종류의 연동이 없으면 `NOT_CONNECTED`
     * - 홈택스인데 동의한 수임동의가 없으면 `DELEGATION_REQUIRED`
     * - 그 종류의 연동이 모두 재시도할 수 없게 실패해 있으면 `PAUSED`({@link isPausedForSchedule}). 일부만 그렇다면 요청을 만들고
     *   워커가 그 연동을 건너뜁니다
     * - 같은 슬롯의 요청이 이미 있으면 그것을 두고 `REPLAYED`(키 `schedule:<슬롯>#<기관 종류>`)
     * - 앞 요청이 아직 진행 중(타임아웃 전)이면 `RUNNING`. 사용자 쿨다운은 정기 수집을 막지 않습니다
     * - 아니면 요청을 만들어 큐에 넣고 `CREATED`
     */
    requestScheduled(
      companyId: Id<'company'>,
      institutionType: InstitutionType,
      slotKey: string,
    ): Effect.Effect<'CREATED' | 'REPLAYED' | 'RUNNING' | 'NOT_CONNECTED' | 'DELEGATION_REQUIRED' | 'PAUSED'>
  }
>()('semu/integrations/ScrapRequests') {
  /** 저장소와 큐 포트로 만듭니다. */
  static readonly layer = Layer.effect(
    ScrapRequests,
    Effect.gen(function* () {
      const repository = yield* ScrapRequestRepository
      const integrations = yield* IntegrationRepository
      const queue = yield* ScrapQueue
      const delegations = yield* DelegationRepository

      /** 홈택스 수집에 수임동의가 필요한데 없으면 참입니다. 세무대리인과 시스템(정기 수집)만 수임동의를 봅니다. */
      const delegationMissing = Effect.fn(function* (
        companyId: Id<'company'>,
        institutionType: InstitutionType,
        requester: Actor['kind'] | 'SYSTEM',
      ) {
        if (institutionType !== 'HOMETAX' || requester === 'CLIENT') return false
        return !hasAgreedDelegation(yield* delegations.listByCompany(companyId))
      })

      const create = Effect.fn(function* (
        requester:
          { companyId: Id<'company'>; kind: 'USER'; userId: Id<'user'> } | { companyId: Id<'company'>; kind: 'SYSTEM' },
        input: ScrapRequestInput,
        idempotencyKey: string,
        isInitial: boolean,
      ) {
        const now = yield* Clock.currentTimeMillis
        const record: ScrapRequestRecord = {
          id: newId('scrapRequest', now),
          companyId: requester.companyId,
          institutionType: input.institutionType,
          ...(input.integrationId === undefined ? {} : { integrationId: input.integrationId }),
          ...(input.itemKey === undefined ? {} : { itemKey: input.itemKey }),
          requester: requester.kind,
          ...(requester.kind === 'USER' ? { requestedBy: requester.userId } : {}),
          status: 'QUEUED',
          isInitial,
          ...(input.options === undefined ? {} : { options: input.options }),
          idempotencyKey,
          createdAt: now,
          timeoutAt: now + SCRAP_TIMEOUT_SECONDS * 1000,
          // 정기(시스템) 수집은 쿨다운을 만들지 않습니다.
          ...(requester.kind === 'USER'
            ? { nextAvailableAt: now + SCRAP_COOLDOWN_SECONDS[input.institutionType] * 1000 }
            : {}),
        }
        yield* repository.save(record)
        yield* queue.enqueue(requester.companyId, record.id)
        return scrapRequestView(record, now)
      })
      const userOf = (actor: Actor) => ({ companyId: actor.companyId, kind: 'USER' as const, userId: actor.userId })

      return ScrapRequests.of({
        request: Effect.fn(function* (actor, input, idempotencyKey) {
          const now = yield* Clock.currentTimeMillis
          const replay = yield* repository.findByIdempotencyKey(actor.companyId, idempotencyKey)
          if (Option.isSome(replay)) return scrapRequestView(replay.value, now)
          const connected = yield* integrations.listByCompany(actor.companyId, input.institutionType)
          if (connected.length === 0) {
            return yield* new InstitutionNotConnected({ institutionType: input.institutionType })
          }
          const scope =
            input.integrationId === undefined
              ? connected
              : connected.filter((integration) => integration.id === input.integrationId)
          const target = scope[0]
          if (target === undefined) return yield* new IntegrationNotFound({})
          if (input.itemKey !== undefined && !target.items.some((item) => item.key === input.itemKey)) {
            return yield* new IntegrationItemNotFound({})
          }
          if (yield* delegationMissing(actor.companyId, input.institutionType, actor.kind)) {
            return yield* new HometaxDelegationRequired({})
          }
          const availability = availabilityOf(yield* repository.latest(actor.companyId, input.institutionType), now)
          if (!availability.canRequest) {
            return yield* new ScrapRequestTooSoon({
              institutionType: input.institutionType,
              reason: availability.reason,
              retryAfterSeconds: availability.retryAfterSeconds,
            })
          }
          return yield* create(
            userOf(actor),
            input,
            idempotencyKey,
            scope.every((integration) => integration.lastScrap === undefined),
          )
        }),
        requestAll: Effect.fn(function* (actor, idempotencyKey) {
          const now = yield* Clock.currentTimeMillis
          const connected = yield* integrations.listByCompany(actor.companyId)
          const items: ScrapRequest[] = []
          const skipped: ScrapAllView['skipped'] = []
          for (const type of INSTITUTION_TYPES) {
            const scope = connected.filter((integration) => integration.type === type)
            if (scope.length === 0) continue
            const key = `${idempotencyKey}#${type}`
            const replay = yield* repository.findByIdempotencyKey(actor.companyId, key)
            if (Option.isSome(replay)) {
              items.push(scrapRequestView(replay.value, now))
              continue
            }
            if (yield* delegationMissing(actor.companyId, type, actor.kind)) {
              skipped.push({ institutionType: type, reason: 'DELEGATION_REQUIRED' })
              continue
            }
            const availability = availabilityOf(yield* repository.latest(actor.companyId, type), now)
            if (!availability.canRequest) {
              skipped.push({
                institutionType: type,
                reason: availability.reason,
                retryAfterSeconds: availability.retryAfterSeconds,
              })
              continue
            }
            items.push(
              yield* create(
                userOf(actor),
                { institutionType: type },
                key,
                scope.every((integration) => integration.lastScrap === undefined),
              ),
            )
          }
          return { items, skipped }
        }),
        requestScheduled: Effect.fn(function* (companyId, institutionType, slotKey) {
          const now = yield* Clock.currentTimeMillis
          const connected = yield* integrations.listByCompany(companyId, institutionType)
          if (connected.length === 0) return 'NOT_CONNECTED' as const
          if (yield* delegationMissing(companyId, institutionType, 'SYSTEM')) return 'DELEGATION_REQUIRED' as const
          const active = connected.filter((integration) => !isPausedForSchedule(integration.lastScrap))
          if (active.length === 0) return 'PAUSED' as const
          const key = `schedule:${slotKey}#${institutionType}`
          if (Option.isSome(yield* repository.findByIdempotencyKey(companyId, key))) return 'REPLAYED' as const
          const latest = Option.getOrUndefined(yield* repository.latest(companyId, institutionType))
          const availability = scrapAvailability(
            latest === undefined ? undefined : { ...latest, requester: 'SYSTEM' },
            now,
          )
          if (!availability.canRequest) return 'RUNNING' as const
          yield* create(
            { companyId, kind: 'SYSTEM' },
            { institutionType },
            key,
            active.every((integration) => integration.lastScrap === undefined),
          )
          return 'CREATED' as const
        }),
        get: Effect.fn(function* (actor, requestId) {
          const found = yield* repository.find(actor.companyId, requestId)
          if (Option.isNone(found)) return yield* new ScrapRequestNotFound({})
          return scrapRequestView(found.value, yield* Clock.currentTimeMillis)
        }),
        list: Effect.fn(function* (actor, type) {
          const now = yield* Clock.currentTimeMillis
          const found = yield* repository.listByCompany(actor.companyId, type)
          return found.map((record) => scrapRequestView(record, now))
        }),
        availability: Effect.fn(function* (actor) {
          const now = yield* Clock.currentTimeMillis
          const connected = yield* integrations.listByCompany(actor.companyId)
          return yield* Effect.forEach(INSTITUTION_TYPES, (type) =>
            Effect.gen(function* () {
              const latest = yield* repository.latest(actor.companyId, type)
              const latestId = Option.map(latest, (found) => found.id)
              const base = {
                institutionType: type,
                ...(Option.isSome(latestId) ? { latestRequestId: latestId.value } : {}),
              }
              if (!connected.some((integration) => integration.type === type)) {
                return { ...base, isConnected: false, canRequest: false, reason: 'NOT_CONNECTED' } as const
              }
              if (yield* delegationMissing(actor.companyId, type, actor.kind)) {
                return { ...base, isConnected: true, canRequest: false, reason: 'DELEGATION_REQUIRED' } as const
              }
              const availability = availabilityOf(latest, now)
              return availability.canRequest
                ? { ...base, isConnected: true, canRequest: true }
                : {
                    ...base,
                    isConnected: true,
                    canRequest: false,
                    reason: availability.reason,
                    retryAfterSeconds: availability.retryAfterSeconds,
                  }
            }),
          )
        }),
      })
    }),
  )
}
