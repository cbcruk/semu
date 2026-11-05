/** 저장하는 초대 상태입니다. 만료는 시각으로 파생하므로 저장하지 않습니다. */
export type StoredInvitationStatus = 'PENDING' | 'ACCEPTED' | 'CANCELED'

/** 응답에 나가는 초대 상태입니다. 현행 탭 `초대완료`(PENDING), `가입완료`(ACCEPTED), `초대 만료`(EXPIRED)입니다. */
export type InvitationStatus = StoredInvitationStatus | 'EXPIRED'

/** 초대에 보낼 수 있는 동작입니다. `REINVITE`는 같은 이메일로 새 초대를 만드는 것입니다. */
export type InvitationAction = 'CANCEL' | 'REINVITE'

/** 새 초대를 막는 이유입니다. */
export type InvitationConflict = 'INVITEE_ALREADY_MEMBER' | 'INVITATION_ALREADY_PENDING'

/** 초대 수락을 막는 이유입니다. */
export type InvitationClosedReason = 'INVITATION_EXPIRED' | 'INVITATION_CANCELED' | 'INVITATION_ALREADY_ACCEPTED'
