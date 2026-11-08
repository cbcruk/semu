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
  const 중간정산 = context.plan?.interimSettlement
  if (중간정산 !== undefined && resignation.leaveDate < 중간정산.date) return 'LEAVE_DATE_BEFORE_INTERIM'
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
  const 중간정산 = plan.interimSettlement
  if (중간정산 !== undefined && leaveDate !== undefined && leaveDate < 중간정산.date) return 'LEAVE_DATE_BEFORE_INTERIM'
  return undefined
}

/**
 * 퇴직금 정산이 끝나 직원 삭제·퇴사 취소·다시 퇴사를 막아야 하는지입니다(현행 `RETIREMENT_COMPLETED`).
 *
 * 그 직원의 정산 중 하나라도 지급 완료(`COMPLETED`)면 막습니다. 지급한 퇴직금은 퇴직일·근속기간으로 계산했고 지급월의
 * 원천세 퇴직소득(A22)에 들어가므로, 퇴직일을 바꾸거나 직원을 지우면 지급 근거가 사라집니다. 계산됨(`CALCULATED`)은 아직
 * 지급 전이라 막지 않고(현행도 완료만 막음), 제외(`EXCLUDED`)는 정산하지 않기로 한 것이라 막지 않습니다. 완료한 정산 때문에
 * 막히면 Payroll에서 `:reopen`으로 계산됨으로 되돌린 뒤 합니다.
 */
export function isSeveranceSettled(statuses: ReadonlyArray<SeveranceSettlementStatus>): boolean {
  return statuses.some((status) => status === 'COMPLETED')
}
