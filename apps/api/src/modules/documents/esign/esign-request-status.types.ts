/** 전자서명 요청 상태입니다. 현행 소문자 값(`draft`, `in_progress` …)을 바꿨습니다. */
export type EsignRequestStatus =
  'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'VOIDED' | 'EXPIRED' | 'CANCELED' | 'SEND_FAILED'

/**
 * 전자서명 요청을 옮기는 사건입니다. 관리자 커맨드, 서명자 동작, 스케줄러를 모두 담습니다.
 *
 * `SEND`·`RESEND`의 실패 결과(`SEND_FAILED`)는 메일 발송 결과로 정해서 따로 `SEND_REJECTED`로 둡니다.
 */
export type EsignRequestEvent =
  | 'UPDATE'
  | 'DELETE'
  | 'SEND'
  | 'RESEND'
  | 'SEND_REJECTED'
  | 'REVERT_TO_DRAFT'
  | 'CANCEL'
  | 'VOID'
  | 'VERIFY_SIGNER'
  | 'COMPLETE'
  | 'EXPIRE'

/** `allowedActions`로 내보내는 관리자 커맨드입니다. */
export type EsignRequestAction =
  'UPDATE' | 'DELETE' | 'SEND' | 'RESEND' | 'REVERT_TO_DRAFT' | 'CANCEL' | 'VOID' | 'DOWNLOAD'

/** 전이 결과입니다. `DELETE`는 상태가 없어지므로 `to`가 `DELETED`입니다. */
export type EsignTransitionResult =
  { ok: true; to: EsignRequestStatus | 'DELETED' } | { ok: false; code: 'ESIGN_REQUEST_TRANSITION_INVALID' }
