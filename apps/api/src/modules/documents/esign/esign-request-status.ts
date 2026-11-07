import { addDays } from '../../../shared/time/calendar.ts'
import type {
  EsignRequestAction,
  EsignRequestEvent,
  EsignRequestStatus,
  EsignTransitionResult,
} from './esign-request-status.types.ts'

/** 취소·만료·발송 실패로 멈춘 요청이 받는 사건입니다. '중단된 요청'은 새로 지은 말입니다. */
const 중단된요청의전이 = {
  RESEND: 'PENDING',
  SEND_REJECTED: 'SEND_FAILED',
  REVERT_TO_DRAFT: 'DRAFT',
  DELETE: 'DELETED',
} as const

const 전이표: Record<EsignRequestStatus, Partial<Record<EsignRequestEvent, EsignRequestStatus | 'DELETED'>>> = {
  DRAFT: { UPDATE: 'DRAFT', DELETE: 'DELETED', SEND: 'PENDING', SEND_REJECTED: 'SEND_FAILED' },
  PENDING: { CANCEL: 'CANCELED', VERIFY_SIGNER: 'IN_PROGRESS', EXPIRE: 'EXPIRED' },
  IN_PROGRESS: { CANCEL: 'CANCELED', VERIFY_SIGNER: 'IN_PROGRESS', COMPLETE: 'COMPLETED', EXPIRE: 'EXPIRED' },
  COMPLETED: { VOID: 'VOIDED' },
  VOIDED: {},
  EXPIRED: 중단된요청의전이,
  CANCELED: 중단된요청의전이,
  SEND_FAILED: 중단된요청의전이,
}

/** 서명 기본 기한(발송일 + 16일)입니다. 매뉴얼 스크린샷 2026.06.23 → 07.09에서 추정했습니다. */
export const ESIGN_DUE_DAYS = 16

/**
 * 현재 상태에 사건을 적용해 다음 상태를 돌려줍니다.
 *
 * 발송 뒤에는 수정·삭제를 받지 않습니다(현행 R25). `:cancel`은 서명 중(`IN_PROGRESS`)에도 받고,
 * 재발송(`RESEND`)은 취소·만료·발송 실패에서 바로 `PENDING`으로 갑니다.
 *
 * @example
 * ```ts
 * transitionEsignRequest('PENDING', 'UPDATE') // { ok: false, code: 'ESIGN_REQUEST_TRANSITION_INVALID' }
 * transitionEsignRequest('EXPIRED', 'RESEND') // { ok: true, to: 'PENDING' }
 * ```
 */
export function transitionEsignRequest(from: EsignRequestStatus, event: EsignRequestEvent): EsignTransitionResult {
  const to = 전이표[from][event]
  return to === undefined ? { ok: false, code: 'ESIGN_REQUEST_TRANSITION_INVALID' } : { ok: true, to }
}

/** 관리자 화면 버튼을 켜는 `allowedActions`입니다. 완료된 요청은 `DOWNLOAD`를 더합니다. */
export function allowedEsignActions(status: EsignRequestStatus): EsignRequestAction[] {
  const 커맨드목록 = ['UPDATE', 'DELETE', 'SEND', 'RESEND', 'REVERT_TO_DRAFT', 'CANCEL', 'VOID'] as const
  const 허용액션: EsignRequestAction[] = 커맨드목록.filter((command) => 전이표[status][command] !== undefined)
  return status === 'COMPLETED' ? [...허용액션, 'DOWNLOAD'] : 허용액션
}

/** 서명자 링크가 닫힌 상태입니다. 완료는 다운로드를 위해 열려 있습니다. */
export function isLinkClosed(status: EsignRequestStatus): boolean {
  return status !== 'PENDING' && status !== 'IN_PROGRESS' && status !== 'COMPLETED'
}

/**
 * 기한이 지나 만료해야 하는지입니다. `dueDate` 다음날 00:00(회사 시간대)부터 만료이므로 `today > dueDate`입니다.
 * 서명 대기·진행 중인 요청만 만료합니다.
 */
export function isOverdue(status: EsignRequestStatus, dueDate: string | undefined, today: string): boolean {
  return (status === 'PENDING' || status === 'IN_PROGRESS') && dueDate !== undefined && today > dueDate
}

/** 발송 시 기한입니다. 지정하지 않았으면 오늘 + {@link ESIGN_DUE_DAYS}일입니다. */
export function dueDateOnSend(requested: string | undefined, today: string): string {
  return requested ?? addDays(today, ESIGN_DUE_DAYS)
}
