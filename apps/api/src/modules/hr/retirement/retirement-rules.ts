import { isValidLeavingReason } from './leaving-reasons.ts'
import type {
  Resignation,
  ResignationRejection,
  RetirementPlan,
  SeveranceSettlementStatus,
} from './retirement.types.ts'

/**
 * 퇴직 등록을 검사합니다. 통과하면 `undefined`입니다.
 *
 * 검사 순서는 중간정산일(퇴직일 ≥ 중간정산일, 현행 `LEAVE_DATE_BEFORE_INTERIM`), 입사일, 사유 코드입니다.
 * 고른 사유는 상실신고에 그대로 들어가므로 상위·상세 코드 조합이 표에 있어야 합니다.
 */
export function checkResignation(
  resignation: Resignation,
  context: { joinDate?: string | undefined; plan?: RetirementPlan | undefined },
): ResignationRejection | undefined {
  const interim = context.plan?.interimSettlement
  if (interim !== undefined && resignation.leaveDate < interim.date) return 'LEAVE_DATE_BEFORE_INTERIM'
  if (context.joinDate !== undefined && resignation.leaveDate < context.joinDate) return 'LEAVE_DATE_BEFORE_JOIN'
  if (!isValidLeavingReason(resignation.leavingReasonCode, resignation.leavingDetailReasonCode)) {
    return 'LEAVING_REASON_INVALID'
  }
  return undefined
}

/**
 * 퇴직금 설정을 바꿀 수 있는지 검사합니다. 이미 퇴직했으면 새 중간정산일이 퇴직일보다 늦을 수 없습니다.
 */
export function checkRetirementPlan(
  plan: RetirementPlan,
  leaveDate: string | undefined,
): ResignationRejection | undefined {
  const interim = plan.interimSettlement
  if (interim !== undefined && leaveDate !== undefined && leaveDate < interim.date) return 'LEAVE_DATE_BEFORE_INTERIM'
  return undefined
}

/** 퇴직금 정산이 끝나 직원 삭제·퇴직 취소를 막아야 하는지입니다(현행 `RETIREMENT_COMPLETED`). */
export function isSeveranceSettled(status: SeveranceSettlementStatus | undefined): boolean {
  return status === 'COMPLETED'
}
