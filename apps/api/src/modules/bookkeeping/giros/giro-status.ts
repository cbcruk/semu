import type { GiroActionType, GiroCommand, GiroDoneReason, GiroStatus } from './giro.types.ts'

const TRANSITIONS: Record<GiroStatus, Partial<Record<GiroCommand, { to: GiroStatus; action: GiroActionType }>>> = {
  TODO: {
    MARK_PAID: { to: 'DONE', action: 'MARKED_PAID' },
    HIDE: { to: 'HIDDEN', action: 'HIDDEN' },
    PAY: { to: 'DONE', action: 'PAID' },
  },
  UNKNOWN: {
    MARK_PAID: { to: 'DONE', action: 'MARKED_PAID' },
    HIDE: { to: 'HIDDEN', action: 'HIDDEN' },
  },
  DONE: {},
  HIDDEN: {},
}

const DONE_REASON: Partial<Record<GiroCommand, GiroDoneReason>> = { MARK_PAID: 'MARKED_BY_USER', PAY: 'PAID_IN_APP' }

/**
 * 고지서 사용자 커맨드의 전이입니다. 허용하지 않으면 `undefined`입니다.
 *
 * `TODO|UNKNOWN → DONE`(수동 완료), `TODO|UNKNOWN → HIDDEN`(숨김), `TODO → DONE`(앱 납부)만 있습니다. 숨김을 되돌리는
 * 커맨드는 현행에 없습니다.
 */
export function transitionGiro(
  from: GiroStatus,
  command: GiroCommand,
): { to: GiroStatus; action: GiroActionType; doneReason: GiroDoneReason | null } | undefined {
  const next = TRANSITIONS[from][command]
  return next === undefined ? undefined : { ...next, doneReason: DONE_REASON[command] ?? null }
}

/** 상태에서 보낼 수 있는 커맨드입니다. `allowedActions`에 씁니다. */
export function allowedGiroCommands(status: GiroStatus): GiroCommand[] {
  return Object.keys(TRANSITIONS[status]) as GiroCommand[]
}

/** 재수집이 고지서 하나에 하는 일입니다. */
export type GiroRefreshStep =
  | { kind: 'INSERT'; status: GiroStatus; doneReason: GiroDoneReason | null; action: 'CREATED' }
  | { kind: 'UPDATE'; status: GiroStatus; doneReason: GiroDoneReason | null; action: GiroActionType | null }

/**
 * 인터넷지로 전체 목록을 다시 읽었을 때 고지서마다 할 일입니다.
 *
 * - 새 고지서: 납부됐으면 `DONE`(`SEEN_PAID`), 아니면 `TODO`
 * - 있던 `TODO`·`UNKNOWN`이 납부됨으로 오면 `DONE`(`SEEN_PAID`). 미납으로 다시 나타난 `UNKNOWN`은 `TODO`로 돌아갑니다
 * - 목록에 없는 `TODO`는 `UNKNOWN`이 됩니다(기한 초과, 고지 취소, 직접 납부)
 * - `DONE`·`HIDDEN`은 그대로 둡니다
 */
export function refreshStep(
  current: { status: GiroStatus; doneReason: GiroDoneReason | null } | undefined,
  seen: { isPaid: boolean } | undefined,
): GiroRefreshStep | undefined {
  if (current === undefined) {
    if (seen === undefined) return undefined
    return seen.isPaid
      ? { kind: 'INSERT', status: 'DONE', doneReason: 'SEEN_PAID', action: 'CREATED' }
      : { kind: 'INSERT', status: 'TODO', doneReason: null, action: 'CREATED' }
  }
  if (seen === undefined) {
    return current.status === 'TODO'
      ? { kind: 'UPDATE', status: 'UNKNOWN', doneReason: null, action: 'MARKED_UNKNOWN' }
      : undefined
  }
  if (seen.isPaid && (current.status === 'TODO' || current.status === 'UNKNOWN')) {
    return { kind: 'UPDATE', status: 'DONE', doneReason: 'SEEN_PAID', action: 'SEEN_PAID' }
  }
  if (!seen.isPaid && current.status === 'UNKNOWN') {
    return { kind: 'UPDATE', status: 'TODO', doneReason: null, action: 'REOPENED' }
  }
  return { kind: 'UPDATE', status: current.status, doneReason: current.doneReason, action: null }
}
