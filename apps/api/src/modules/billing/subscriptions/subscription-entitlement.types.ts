import type { Plan } from '../../identity-access/actor.types.ts'

/**
 * 구독 상태입니다. 현행 `pending → active → cancelled → ended`를 옮겼습니다.
 *
 * - `PENDING`: 계약했지만 시작일 전
 * - `ACTIVE`: 이용 중
 * - `CANCELLATION_SCHEDULED`: 해지 예약. 종료일까지 플랜을 유지합니다 (현행 `cancelled`)
 * - `ENDED`: 끝남
 */
export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'CANCELLATION_SCHEDULED' | 'ENDED'

/** 구독 상태를 바꾸는 담당자 커맨드입니다. */
export type SubscriptionCommand = 'CANCEL' | 'RESUME'

/** 플랜 판정에 필요한 구독 값입니다. 날짜는 회사 시간대의 `YYYY-MM-DD`입니다. */
export interface SubscriptionTerm {
  plan: Plan
  status: SubscriptionStatus
  startsOn: string
  /** 마지막 이용일(포함)입니다. 없으면 기한 없음입니다. */
  endsOn?: string | undefined
}
