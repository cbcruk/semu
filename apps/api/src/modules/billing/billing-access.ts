import { Clock, Effect } from 'effect'
import { IdempotencyKeyRequired, PermissionDenied } from '../../shared/problem/problem.ts'
import { companyDate } from '../../shared/time/company-date.ts'
import type { CurrentActor } from '../identity-access/actor.ts'
import type { Actor, Permission } from '../identity-access/actor.types.ts'
import { authorize } from '../identity-access/authorization.ts'
import type { AccessDenied } from '../identity-access/authorization.ts'

/**
 * 세무 대리인 담당자만 하는 커맨드(구독 변경, 결제 재시도·환불)의 접근을 확인합니다.
 *
 * 고객 관리자도 `*` 권한을 받으므로 권한 문자열만으로는 막을 수 없어 행위자 종류를 함께 봅니다.
 */
export const authorizeAgency = (permission: Permission): Effect.Effect<Actor, AccessDenied, CurrentActor> =>
  Effect.flatMap(authorize({ permission }), (actor) =>
    actor.kind === 'AGENCY' ? Effect.succeed(actor) : Effect.fail(new PermissionDenied({ permission })),
  )

/** 회사 시간대의 오늘 날짜입니다. */
export const today: Effect.Effect<string> = Effect.map(Clock.currentTimeMillis, (millis) => companyDate(millis))

/** 지금 시각(RFC 3339, UTC)입니다. */
export const nowIso: Effect.Effect<string> = Effect.map(Clock.currentTimeMillis, (millis) =>
  new Date(millis).toISOString(),
)

/** 외부 효과가 있는 커맨드에 `Idempotency-Key`가 없으면 428로 실패합니다. 같은 키의 재요청 재생은 아직 하지 않습니다. */
export const requireIdempotencyKey = (key: string | undefined): Effect.Effect<void, IdempotencyKeyRequired> =>
  key === undefined || key.length === 0 ? Effect.fail(new IdempotencyKeyRequired({})) : Effect.void
