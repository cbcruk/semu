import type { ActorKind } from '../../identity-access/actor.types.ts'
import type {
  LedgerAction,
  LedgerStatus,
  LedgerTransition,
  LedgerTransitionContext,
  LedgerTransitionDecision,
  LedgerTransitionRule,
  LedgerWorkflow,
} from './ledger-status.types.ts'

const BOTH: readonly ActorKind[] = ['CLIENT', 'AGENCY']

/**
 * 급여대장 전이표입니다. 상태를 바꾸는 규칙은 여기 한 곳에만 있습니다.
 *
 * 현행 `CARD_TRANSITIONS`에서 명세서 발송·데스크 내보내기를 상태에서 빼고(마감 후 별도 기록),
 * 담당자 확정·해제(`legacyFix`·`legacyRelease`)를 직접 운영 방식의 `CLOSE`·`REOPEN`으로 바꿨습니다.
 */
export const LEDGER_TRANSITIONS = {
  SUBMIT: {
    from: ['DRAFT'],
    to: 'SUBMITTED',
    actors: { CLIENT_APPROVAL: BOTH, DIRECT_CLOSE: BOTH },
    locksOnFiledWithholding: true,
  },
  RETURN_TO_DRAFT: {
    from: ['SUBMITTED'],
    to: 'DRAFT',
    actors: { CLIENT_APPROVAL: ['AGENCY'], DIRECT_CLOSE: BOTH },
    locksOnFiledWithholding: true,
  },
  REQUEST_APPROVAL: {
    from: ['SUBMITTED'],
    to: 'PENDING_APPROVAL',
    actors: { CLIENT_APPROVAL: ['AGENCY'] },
    locksOnFiledWithholding: false,
  },
  WITHDRAW_APPROVAL_REQUEST: {
    from: ['PENDING_APPROVAL'],
    to: 'SUBMITTED',
    actors: { CLIENT_APPROVAL: ['AGENCY'] },
    locksOnFiledWithholding: true,
  },
  APPROVE: {
    from: ['PENDING_APPROVAL'],
    to: 'CLOSED',
    actors: { CLIENT_APPROVAL: ['CLIENT'] },
    locksOnFiledWithholding: false,
  },
  REJECT: {
    from: ['PENDING_APPROVAL'],
    to: 'SUBMITTED',
    actors: { CLIENT_APPROVAL: ['CLIENT'] },
    locksOnFiledWithholding: true,
  },
  CLOSE: {
    from: ['DRAFT', 'SUBMITTED'],
    to: 'CLOSED',
    actors: { DIRECT_CLOSE: BOTH },
    locksOnFiledWithholding: false,
  },
  REOPEN: {
    from: ['CLOSED'],
    to: 'SUBMITTED',
    actors: { CLIENT_APPROVAL: BOTH, DIRECT_CLOSE: BOTH },
    locksOnFiledWithholding: true,
  },
} as const satisfies Record<LedgerTransition, LedgerTransitionRule>

/** 상태별로 입력(행 추가·수정·삭제, 대장 머리 수정)을 고칠 수 있는 행위자입니다. */
export const INPUT_EDITORS: Readonly<Record<LedgerStatus, readonly ActorKind[]>> = {
  DRAFT: BOTH,
  SUBMITTED: ['AGENCY'],
  PENDING_APPROVAL: [],
  CLOSED: [],
}

/**
 * 전이를 할 수 있는지 판정합니다. 상태·운영 방식·행위자가 맞지 않으면 `TRANSITION_INVALID`,
 * 맞지만 지급월 원천세 신고가 끝나 막히면 `WITHHOLDING_FILED`입니다.
 *
 * @example 신고가 끝난 지급월의 마감 해제
 * ```ts
 * decideTransition('REOPEN', { status: 'CLOSED', workflow: 'DIRECT_CLOSE', actor: 'CLIENT', withholdingFiled: true })
 * // { ok: false, reason: 'WITHHOLDING_FILED' }
 * ```
 */
export function decideTransition(
  transition: LedgerTransition,
  context: LedgerTransitionContext,
): LedgerTransitionDecision {
  const rule: LedgerTransitionRule = LEDGER_TRANSITIONS[transition]
  const actors = rule.actors[context.workflow] ?? []
  if (!rule.from.includes(context.status) || !actors.includes(context.actor)) {
    return { ok: false, reason: 'TRANSITION_INVALID' }
  }
  if (rule.locksOnFiledWithholding && context.withholdingFiled) return { ok: false, reason: 'WITHHOLDING_FILED' }
  return { ok: true, to: rule.to }
}

/** 지금 상태에서 행위자가 입력을 고칠 수 있는지입니다. 신고 잠금은 따로 봅니다. */
export function canEditInput(status: LedgerStatus, actor: ActorKind): boolean {
  return INPUT_EDITORS[status].includes(actor)
}

/** 목록 화면의 `n/3` 진행 단계입니다. */
export function stepOf(status: LedgerStatus): 1 | 2 | 3 {
  if (status === 'DRAFT') return 1
  if (status === 'CLOSED') return 3
  return 2
}

/** 인건비 보고서에 금액을 넣는 상태인지입니다. 현행처럼 계산 확정 이후만 셉니다. */
export function countsAsCalculated(status: LedgerStatus): boolean {
  return status !== 'DRAFT'
}

/**
 * 상세 응답의 `allowedActions`를 만듭니다. 서버가 실제로 받아 줄 동작만 넣습니다.
 *
 * `DELETE`는 입력 중인 대장에만, `RECALCULATE`·`EDIT_ROWS`는 입력을 고칠 수 있을 때만 나옵니다.
 * 원천세 신고가 끝난 지급월이면 금액이 바뀌는 동작은 빠집니다.
 */
export function allowedActions(context: LedgerTransitionContext): LedgerAction[] {
  const actions: LedgerAction[] = []
  for (const transition of Object.keys(LEDGER_TRANSITIONS) as LedgerTransition[]) {
    if (decideTransition(transition, context).ok) actions.push(transition)
  }
  if (canEditInput(context.status, context.actor) && !context.withholdingFiled) {
    actions.push('EDIT_ROWS', 'RECALCULATE')
    if (context.status === 'DRAFT') actions.push('DELETE')
  }
  return actions
}

/** 운영 방식에서 쓰이는 전이 목록입니다. 문서와 테스트에 씁니다. */
export function transitionsOf(workflow: LedgerWorkflow): LedgerTransition[] {
  return (Object.keys(LEDGER_TRANSITIONS) as LedgerTransition[]).filter(
    (transition) => (LEDGER_TRANSITIONS[transition] as LedgerTransitionRule).actors[workflow] !== undefined,
  )
}
