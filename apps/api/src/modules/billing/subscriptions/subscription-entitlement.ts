import type { Plan } from '../../identity-access/actor.types.ts'
import type { SubscriptionCommand, SubscriptionStatus, SubscriptionTerm } from './subscription-entitlement.types.ts'

/** 플랜을 응답에 담는 순서입니다. */
export const PLAN_ORDER: ReadonlyArray<Plan> = ['TAXATION', 'PAYROLL']

/**
 * 날짜가 지나 저절로 바뀌는 상태를 반영합니다. 현행은 매일 작업이 바꿨지만, 여기서는 읽을 때마다 계산해 작업이 늦어도 어긋나지 않습니다.
 *
 * - 시작일이 된 `PENDING`은 `ACTIVE`입니다
 * - 종료일이 지난 `ACTIVE`·`CANCELLATION_SCHEDULED`는 `ENDED`입니다
 */
export function refreshedStatus(term: SubscriptionTerm, today: string): SubscriptionStatus {
  const ended = term.endsOn !== undefined && term.endsOn < today
  if (term.status === 'PENDING') {
    if (term.startsOn > today) return 'PENDING'
    return ended ? 'ENDED' : 'ACTIVE'
  }
  if (term.status === 'ENDED') return 'ENDED'
  return ended ? 'ENDED' : term.status
}

/** 그날 이 구독으로 플랜을 쓸 수 있는지입니다. 해지 예약 중에도 종료일(포함)까지는 씁니다. */
export function isEntitledOn(term: SubscriptionTerm, today: string): boolean {
  const status = refreshedStatus(term, today)
  return (status === 'ACTIVE' || status === 'CANCELLATION_SCHEDULED') && term.startsOn <= today
}

/** 그날 회사가 쓸 수 있는 플랜입니다. {@link PLAN_ORDER} 순서이고 중복이 없습니다. */
export function entitledPlans(terms: ReadonlyArray<SubscriptionTerm>, today: string): Plan[] {
  return PLAN_ORDER.filter((plan) => terms.some((term) => term.plan === plan && isEntitledOn(term, today)))
}

/** 유료 플랜이 하나도 없는 무료 고객인지입니다. 현행 클라이언트의 `isFree`를 서버가 정합니다. */
export function isFreeOn(terms: ReadonlyArray<SubscriptionTerm>, today: string): boolean {
  return entitledPlans(terms, today).length === 0
}

/**
 * 담당자 커맨드로 바뀌는 다음 상태입니다. 허용되지 않으면 `undefined`입니다.
 *
 * - `CANCEL`: 시작 전이면 바로 `ENDED`, 이용 중이면 `CANCELLATION_SCHEDULED`
 * - `RESUME`: 해지 예약을 거둬 `ACTIVE`
 */
export function subscriptionTransition(
  status: SubscriptionStatus,
  command: SubscriptionCommand,
): SubscriptionStatus | undefined {
  if (command === 'CANCEL') {
    if (status === 'PENDING') return 'ENDED'
    if (status === 'ACTIVE') return 'CANCELLATION_SCHEDULED'
    return undefined
  }
  return status === 'CANCELLATION_SCHEDULED' ? 'ACTIVE' : undefined
}

/** 상태에서 할 수 있는 담당자 커맨드입니다. */
export function allowedSubscriptionCommands(status: SubscriptionStatus): SubscriptionCommand[] {
  return (['CANCEL', 'RESUME'] as const).filter((command) => subscriptionTransition(status, command) !== undefined)
}
