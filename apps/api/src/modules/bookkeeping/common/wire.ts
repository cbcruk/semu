import { Effect, Schema } from 'effect'
import { authorize } from '../../identity-access/authorization.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import type { Actor, Permission } from '../../identity-access/actor.types.ts'
import type { PermissionDenied } from '../../../shared/problem/problem.ts'
import { isCalendarDate } from '../../../shared/time/date-format.ts'

/** `YYYY-MM-DD` 형식의 실제 날짜입니다. */
export const CalendarDate = Schema.String.check(Schema.makeFilter((value: string) => isCalendarDate(value)))

/** `YYYY-MM` 형식의 달입니다. */
export const CalendarMonth = Schema.String.check(
  Schema.makeFilter((value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)),
)

/** 원 단위 정수 금액입니다. 취소·출금은 음수입니다. */
export const Won = Schema.Int

/** 공급가액·세액·합계를 함께 다니는 금액입니다. */
export const Amounts = Schema.Struct({ supplyAmount: Won, vatAmount: Won, totalAmount: Won })

/** 다른 사람의 변경을 덮어쓰지 않도록 보내는 버전입니다. 예: `"7"` */
export const IfMatchHeaders = { 'if-match': Schema.optionalKey(Schema.String) }

/** 돈이 오가거나 외부 효과가 있는 요청의 멱등 키 헤더입니다. 없으면 428입니다. */
export const IdempotencyHeaders = { 'idempotency-key': Schema.optionalKey(Schema.String) }

/** 쿼리 문자열 불리언입니다. */
export const QueryFlag = Schema.Literals(['true', 'false'])

/** 연도 쿼리입니다. */
export const YearQuery = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 2000, maximum: 2100 })),
)

/** 거래 메모는 50자까지입니다(입출금 화면 규칙). */
export const Memo = Schema.String.check(Schema.isMaxLength(50))

/**
 * 플랜이 필요 없는 경리 엔드포인트의 권한 검사입니다.
 *
 * 플랜·약관을 요구하지 않으므로 그 두 거절은 나올 수 없어 결함으로 바꿉니다.
 */
export function requirePermission(permission: Permission): Effect.Effect<Actor, PermissionDenied, CurrentActor> {
  return authorize({ permission }).pipe(
    Effect.catchTag(['EntitlementRequired', 'TermsReagreementRequired'], Effect.die),
  )
}
