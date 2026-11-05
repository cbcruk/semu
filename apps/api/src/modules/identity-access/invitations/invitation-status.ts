import type {
  InvitationAction,
  InvitationClosedReason,
  InvitationConflict,
  InvitationStatus,
  StoredInvitationStatus,
} from './invitation-status.types.ts'

/** 초대 유효 기간(일)입니다. 매뉴얼의 "30일 이내에 가입하지 않으면 초대가 만료됩니다"입니다. */
export const INVITATION_TTL_DAYS = 30

const DAY_MILLIS = 86_400_000

/**
 * 지금 시각의 초대 상태입니다. `PENDING`인데 만료 시각이 지났으면 `EXPIRED`입니다.
 *
 * 만료 시각과 같은 순간부터 만료입니다. 배치로 상태를 바꾸지 않고 읽을 때 파생합니다.
 */
export function invitationStatus(stored: StoredInvitationStatus, expiresAt: string, now: number): InvitationStatus {
  if (stored === 'PENDING' && now >= Date.parse(expiresAt)) return 'EXPIRED'
  return stored
}

/** 만료까지 남은 날(올림)입니다. 화면의 "유효기간 N일 남음"이고, 만료됐으면 0입니다. */
export function remainingDays(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / DAY_MILLIS))
}

/** 상태별로 보낼 수 있는 동작입니다. 응답의 `allowedActions`에 씁니다. */
export function allowedInvitationActions(status: InvitationStatus): InvitationAction[] {
  if (status === 'PENDING') return ['CANCEL']
  if (status === 'EXPIRED' || status === 'CANCELED') return ['REINVITE']
  return []
}

/**
 * 같은 회사에 같은 이메일로 새 초대를 만들 수 있는지입니다.
 *
 * 이미 구성원이면 초대할 수 없고, 유효한 초대가 있으면 취소한 뒤 다시 초대해야 합니다(매뉴얼, spec 3.1).
 * 만료되거나 취소된 초대는 막지 않습니다.
 */
export function invitationConflict(input: {
  isMember: boolean
  statuses: ReadonlyArray<InvitationStatus>
}): InvitationConflict | undefined {
  if (input.isMember) return 'INVITEE_ALREADY_MEMBER'
  if (input.statuses.includes('PENDING')) return 'INVITATION_ALREADY_PENDING'
  return undefined
}

/** 초대를 수락할 수 없는 이유입니다. 유효하면 `undefined`입니다. */
export function invitationClosedReason(status: InvitationStatus): InvitationClosedReason | undefined {
  switch (status) {
    case 'PENDING':
      return undefined
    case 'EXPIRED':
      return 'INVITATION_EXPIRED'
    case 'CANCELED':
      return 'INVITATION_CANCELED'
    case 'ACCEPTED':
      return 'INVITATION_ALREADY_ACCEPTED'
  }
}
