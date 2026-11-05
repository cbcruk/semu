import type { ActorKind } from '../../identity-access/actor.types.ts'

/**
 * 급여대장 상태입니다.
 *
 * - `DRAFT`: 입력 중(현행 `inputting`, 입력가능)
 * - `SUBMITTED`: 입력을 마치고 계산을 확정함(현행 `calculated`, 계산중)
 * - `PENDING_APPROVAL`: 담당자가 고객에게 승인을 요청함(현행 `approval_requested`)
 * - `CLOSED`: 마감됨(현행 `approved`·`payslips_sent`·`exported`, 완료)
 */
export type LedgerStatus = 'DRAFT' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'CLOSED'

/**
 * 회사의 급여 운영 방식입니다.
 *
 * - `CLIENT_APPROVAL`: 급여 아웃소싱(BPO). 담당자가 계산하고 고객이 승인해야 마감됩니다
 * - `DIRECT_CLOSE`: 고객이 직접 운영(현행 급여관리). 승인 단계 없이 마감합니다
 */
export type LedgerWorkflow = 'CLIENT_APPROVAL' | 'DIRECT_CLOSE'

/** 급여대장 상태 커맨드입니다. 경로의 `:submit` 등과 1:1입니다. */
export type LedgerTransition =
  | 'SUBMIT'
  | 'RETURN_TO_DRAFT'
  | 'REQUEST_APPROVAL'
  | 'WITHDRAW_APPROVAL_REQUEST'
  | 'APPROVE'
  | 'REJECT'
  | 'CLOSE'
  | 'REOPEN'

/** 상태 전이가 아닌 대장 동작입니다. `allowedActions`에 함께 나옵니다. */
export type LedgerEditAction = 'EDIT_ROWS' | 'RECALCULATE' | 'DELETE'

/** 상세 응답 `allowedActions`의 값입니다. */
export type LedgerAction = LedgerTransition | LedgerEditAction

/** 전이표의 한 줄입니다. */
export interface LedgerTransitionRule {
  from: readonly LedgerStatus[]
  to: LedgerStatus
  /** 운영 방식별로 이 전이를 할 수 있는 행위자입니다. 없는 운영 방식에서는 전이가 없습니다. */
  actors: Partial<Record<LedgerWorkflow, readonly ActorKind[]>>
  /** 지급월 원천세 신고가 끝났으면 막는지입니다. 금액이 바뀔 수 있는 전이만 막습니다. */
  locksOnFiledWithholding: boolean
}

/** 전이를 판정하는 데 필요한 사실입니다. */
export interface LedgerTransitionContext {
  status: LedgerStatus
  workflow: LedgerWorkflow
  actor: ActorKind
  /** 지급월 원천세 신고가 끝났는지입니다. */
  withholdingFiled: boolean
}

/** 전이 판정 결과입니다. 거절이면 사유를 줍니다. */
export type LedgerTransitionDecision =
  { ok: true; to: LedgerStatus } | { ok: false; reason: 'TRANSITION_INVALID' | 'WITHHOLDING_FILED' }
