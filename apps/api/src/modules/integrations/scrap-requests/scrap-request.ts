import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { JobStatus } from '../../../shared/jobs/job.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { InstitutionTypeSchema } from '../institutions/institution.ts'
import type { InstitutionType } from '../institutions/institution.ts'
import { IntegrationId } from '../integrations/integration.ts'

/** 수집 요청 ID입니다. 예: `scr_01J...` */
export const ScrapRequestId = IdSchema('scrapRequest')

/** 작업 상태입니다. `docs/design/conventions.md`의 `Job`과 같습니다. */
export const JobStatusSchema = Schema.Literals([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIALLY_SUCCEEDED',
  'FAILED',
  'CANCELED',
])

/** 수집 옵션입니다. */
export const ScrapOptions = Schema.Struct({
  /** 홈택스에서 법인번호 없이 조회합니다(현행 `corporation_number_unused`). */
  corporationNumberUnused: Schema.optionalKey(Schema.Boolean),
})

/** 항목 하나의 수집 결과입니다. */
export const ScrapItemResult = Schema.Struct({
  integrationId: IntegrationId,
  itemKey: Schema.optionalKey(Schema.String),
  status: Schema.Literals(['SUCCEEDED', 'FAILED']),
  code: Schema.optionalKey(Schema.String),
  isRetryable: Schema.Boolean,
  recordCount: Schema.Int,
})

/** 항목 하나의 수집 결과입니다. */
export type ScrapItemResult = typeof ScrapItemResult.Type

/**
 * 수집 요청입니다. `Job` 형태이고, 현행 `ScrapRequest`(`request|done|timeout`)와 폴링 `ScrappingStatus`(`PROGRESS|SUCCESS|FAIL`)를 대신합니다.
 *
 * 일부 항목만 실패하면 `PARTIALLY_SUCCEEDED`이고 항목별 결과는 `result.items`에 있습니다.
 */
export const ScrapRequest = Schema.Struct({
  id: ScrapRequestId,
  institutionType: InstitutionTypeSchema,
  integrationId: Schema.optionalKey(IntegrationId),
  itemKey: Schema.optionalKey(Schema.String),
  requester: Schema.Literals(['USER', 'SYSTEM']),
  status: JobStatusSchema,
  /** 그 기관의 첫 수집이면 참입니다. 기관이 주는 최대 기간을 가져옵니다. */
  isInitial: Schema.Boolean,
  options: Schema.optionalKey(ScrapOptions),
  result: Schema.optionalKey(Schema.Struct({ items: Schema.Array(ScrapItemResult) })),
  error: Schema.optionalKey(Schema.Struct({ code: Schema.String, title: Schema.String })),
  createdAt: Schema.String,
  startedAt: Schema.optionalKey(Schema.String),
  finishedAt: Schema.optionalKey(Schema.String),
  /** 이때까지 끝나지 않으면 `FAILED`(`SCRAP_TIMEOUT`)입니다. */
  timeoutAt: Schema.String,
  /** 사용자 요청이면 같은 기관을 다시 수동 수집할 수 있는 시각입니다. */
  nextAvailableAt: Schema.optionalKey(Schema.String),
})

/** 수집 요청입니다. */
export type ScrapRequest = typeof ScrapRequest.Type

/** 저장소가 가진 수집 요청입니다. 시각은 epoch 밀리초입니다. */
export interface ScrapRequestRecord {
  id: Id<'scrapRequest'>
  companyId: Id<'company'>
  institutionType: InstitutionType
  integrationId?: Id<'integration'>
  itemKey?: string
  requester: 'USER' | 'SYSTEM'
  requestedBy?: Id<'user'>
  status: JobStatus
  isInitial: boolean
  options?: { corporationNumberUnused?: boolean }
  results?: ScrapItemResult[]
  idempotencyKey?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  timeoutAt: number
  nextAvailableAt?: number
}

/** 수동 수집 요청입니다. `integrationId`·`itemKey`로 범위를 좁힐 수 있습니다. */
export const ScrapRequestInput = Schema.Struct({
  institutionType: InstitutionTypeSchema,
  integrationId: Schema.optionalKey(IntegrationId),
  itemKey: Schema.optionalKey(Schema.String),
  options: Schema.optionalKey(ScrapOptions),
})

/** 수동 수집 요청입니다. */
export type ScrapRequestInput = typeof ScrapRequestInput.Type

/** 기관별 수동 수집 가능 여부입니다. 현행 `last-scrap-request-status`의 `canScrapping`·`remainSeconds`입니다. */
export const ScrapAvailabilityItem = Schema.Struct({
  institutionType: InstitutionTypeSchema,
  isConnected: Schema.Boolean,
  canRequest: Schema.Boolean,
  /**
   * `RUNNING`이면 화면은 남은 시간 대신 "수집 중"을 보입니다. `DELEGATION_REQUIRED`는 세무대리인이 수임동의 없는 회사의 홈택스를
   * 수집하려 할 때입니다.
   */
  reason: Schema.optionalKey(Schema.Literals(['RUNNING', 'COOLDOWN', 'NOT_CONNECTED', 'DELEGATION_REQUIRED'])),
  retryAfterSeconds: Schema.optionalKey(Schema.Int),
  latestRequestId: Schema.optionalKey(ScrapRequestId),
})

/**
 * 전체 수집 응답입니다. 연동은 있지만 진행 중·쿨다운이거나 수임동의가 없어 넣지 않은 기관은 `skipped`에 있습니다.
 * `retryAfterSeconds`는 진행 중·쿨다운일 때만 있습니다.
 */
export const ScrapAllResult = Schema.Struct({
  items: Schema.Array(ScrapRequest),
  skipped: Schema.Array(
    Schema.Struct({
      institutionType: InstitutionTypeSchema,
      reason: Schema.Literals(['RUNNING', 'COOLDOWN', 'DELEGATION_REQUIRED']),
      retryAfterSeconds: Schema.optionalKey(Schema.Int),
    }),
  ),
})

/** 요청한 수집 요청이 없습니다. */
export class ScrapRequestNotFound extends HttpApiError.Problem<ScrapRequestNotFound>()(
  'ScrapRequestNotFound',
  { type: problemType('SCRAP_REQUEST_NOT_FOUND'), status: 404, title: 'Scrap request not found' },
  { code: Schema.tag('SCRAP_REQUEST_NOT_FOUND') },
) {}

/** 앞 수집이 진행 중이거나 쿨다운 중입니다. `retryAfterSeconds` 뒤에 다시 요청합니다. */
export class ScrapRequestTooSoon extends HttpApiError.Problem<ScrapRequestTooSoon>()(
  'ScrapRequestTooSoon',
  { type: problemType('SCRAP_REQUEST_TOO_SOON'), status: 429, title: 'Collection was requested too soon' },
  {
    code: Schema.tag('SCRAP_REQUEST_TOO_SOON'),
    institutionType: InstitutionTypeSchema,
    reason: Schema.Literals(['RUNNING', 'COOLDOWN']),
    retryAfterSeconds: Schema.Int,
  },
) {}

/** 이 기관에 연동이 하나도 없어 수집할 수 없습니다. */
export class InstitutionNotConnected extends HttpApiError.Problem<InstitutionNotConnected>()(
  'InstitutionNotConnected',
  { type: problemType('INSTITUTION_NOT_CONNECTED'), status: 422, title: 'Institution is not connected' },
  { code: Schema.tag('INSTITUTION_NOT_CONNECTED'), institutionType: InstitutionTypeSchema },
) {}

/** 세무대리인이 홈택스를 수집하려 했지만 이 회사에 동의한 홈택스 수임동의가 없습니다. */
export class HometaxDelegationRequired extends HttpApiError.Problem<HometaxDelegationRequired>()(
  'HometaxDelegationRequired',
  { type: problemType('HOMETAX_DELEGATION_REQUIRED'), status: 422, title: 'Hometax delegation is not agreed' },
  { code: Schema.tag('HOMETAX_DELEGATION_REQUIRED') },
) {}
