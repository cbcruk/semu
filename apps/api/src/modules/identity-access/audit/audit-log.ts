import { Clock, Context, Effect, Layer, Schema } from 'effect'
import { monotonicFactory } from 'ulid'
import { ID_PREFIXES } from '../../../shared/ids/ids.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 보안 감사 로그에 남기는 동작입니다. */
export const AuditAction = Schema.Literals([
  'SIGN_IN_SUCCEEDED',
  'SIGN_IN_FAILED',
  'ACCOUNT_LOCKED',
  'SIGNED_OUT',
  'SESSION_REUSE_DETECTED',
  'COMPANY_SWITCHED',
  'PASSWORD_CHANGED',
  'COMPANY_REGISTERED',
  'COMPANY_UPDATED',
  'MEMBER_ACCESS_CHANGED',
  'MEMBER_REMOVED',
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_DELETED',
  'INVITATION_CREATED',
  'INVITATION_CANCELED',
  'INVITATION_ACCEPTED',
  'TERMS_DECIDED',
])

export type AuditAction = typeof AuditAction.Type

/** 감사 로그 한 줄입니다. 쓰기 요청의 before/after 해시는 커맨드 감사(conventions.md)가 따로 남깁니다. */
export const AuditEntry = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.String,
  action: AuditAction,
  /** 회사와 무관한 동작(로그인 실패 등)은 없습니다. */
  companyId: Schema.optionalKey(Schema.String),
  actorUserId: Schema.optionalKey(Schema.String),
  actorKind: Schema.optionalKey(Schema.Literals(['CLIENT', 'AGENCY'])),
  /** 대상 리소스 ID입니다. 예: 바뀐 구성원의 사용자 ID */
  targetId: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
})

export type AuditEntry = typeof AuditEntry.Type

/** 감사 로그에 남길 내용입니다. ID와 시각은 서비스가 채웁니다. */
export interface AuditInput {
  action: AuditAction
  companyId?: Id<'company'> | undefined
  actorUserId?: Id<'user'> | undefined
  actorKind?: 'CLIENT' | 'AGENCY' | undefined
  targetId?: string | undefined
  detail?: string | undefined
}

/** 보안 감사 로그입니다. 덧붙이기만 하고 고치거나 지우지 않습니다. */
export class AuditLog extends Context.Service<
  AuditLog,
  {
    record(input: AuditInput): Effect.Effect<void>
    /** 회사의 감사 로그를 최근 것부터 돌려줍니다. */
    listByCompany(companyId: Id<'company'>): Effect.Effect<AuditEntry[]>
  }
>()('semu/identity-access/AuditLog') {
  /**
   * `iam_audit_log` 표에 쌓습니다. ID는 단조 증가하는 ULID라 같은 밀리초에 남긴 줄도 ID 순이 곧 남긴 순입니다.
   */
  static readonly layer: Layer.Layer<AuditLog, never, TableFactory> = Layer.effect(
    AuditLog,
    Effect.gen(function* () {
      const table = yield* (yield* TableFactory).make<AuditEntry>('iam_audit_log', {
        companyOf: (entry) => entry.companyId ?? null,
      })
      const nextUlid = monotonicFactory()
      return AuditLog.of({
        record: (input) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const entry: AuditEntry = {
              id: `${ID_PREFIXES.event}_${nextUlid(now)}`,
              occurredAt: new Date(now).toISOString(),
              action: input.action,
              ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
              ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
              ...(input.actorKind === undefined ? {} : { actorKind: input.actorKind }),
              ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
              ...(input.detail === undefined ? {} : { detail: input.detail }),
            }
            yield* table.put(entry)
          }),
        listByCompany: (companyId) => Effect.map(table.byCompany(companyId), (entries) => entries.toReversed()),
      })
    }),
  )

  /** 프로세스 메모리에 쌓습니다. */
  static readonly layerMemory = AuditLog.layer.pipe(Layer.provide(TableFactory.layerMemory))
}
