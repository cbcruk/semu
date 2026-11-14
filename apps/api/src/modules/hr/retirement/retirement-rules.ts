import { isValidLeavingReason } from './leaving-reasons.ts'
import type {
  Resignation,
  ResignationRejection,
  RetirementPlan,
  SeveranceSettlementSummary,
} from './retirement.types.ts'

/**
 * 퇴직 등록을 검사합니다. 통과하면 `undefined`입니다.
 *
 * 검사 순서는 중간정산일(퇴직일 ≥ 중간정산일, 현행 `LEAVE_DATE_BEFORE_INTERIM`), 입사일, 사유 코드입니다.
 * 중간정산일은 퇴직금 설정의 값과 Payroll에서 완료한 마지막 중간정산 기준일(`interimSettlementDate`) 중 늦은 날입니다.
 * 고른 사유는 상실신고에 그대로 들어가므로 상위·상세 코드 조합이 표에 있어야 합니다.
 */
export function checkResignation(
  resignation: Resignation,
  context: {
    joinDate?: string | undefined
    plan?: RetirementPlan | undefined
    interimSettlementDate?: string | undefined
  },
): ResignationRejection | undefined {
  const 중간정산일들 = [context.plan?.interimSettlement?.date, context.interimSettlementDate].filter(
    (date) => date !== undefined,
  )
  if (중간정산일들.some((date) => resignation.leaveDate < date)) return 'LEAVE_DATE_BEFORE_INTERIM'
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
 * 퇴직금 정산이 끝나 직원 삭제·퇴사·퇴사 취소를 막아야 하는지입니다(현행 `RETIREMENT_COMPLETED`).
 *
 * 지급한 퇴직금은 퇴직일·근속기간으로 계산했고 지급월의 원천세 퇴직소득(A22)에 들어가므로, 퇴직일을 바꾸거나 직원을 지우면
 * 지급 근거가 사라집니다. 계산됨(`CALCULATED`)은 아직 지급 전이라 막지 않고(현행도 완료만 막음), 제외(`EXCLUDED`)는 정산하지
 * 않기로 한 것이라 막지 않습니다. 완료한 정산 때문에 막히면 Payroll에서 `:reopen`으로 계산됨으로 되돌린 뒤 합니다.
 *
 * - 삭제(`DELETE`)는 완료 정산이 종류와 상관없이 하나라도 있으면 막습니다. 중간정산도 지급 기록입니다
 * - 퇴사·퇴사 취소(`RESIGNATION`)는 완료한 **퇴직** 정산만 막습니다. 완료한 중간정산은 재직 중 지급이라 퇴직일과 상관없고,
 *   퇴직일이 그 기준일보다 앞서는지는 {@link checkResignation}이 봅니다
 */
export function isSeveranceSettled(
  settlements: ReadonlyArray<SeveranceSettlementSummary>,
  command: 'DELETE' | 'RESIGNATION',
): boolean {
  return settlements.some(
    (settlement) => settlement.status === 'COMPLETED' && (command === 'DELETE' || settlement.kind === 'RETIREMENT'),
  )
}

/** Payroll에서 완료한 마지막 중간정산 기준일입니다. 없으면 `undefined`입니다. 퇴직일이 이보다 앞설 수 없습니다. */
export function latestCompletedInterimDate(settlements: ReadonlyArray<SeveranceSettlementSummary>): string | undefined {
  return settlements
    .filter((settlement) => settlement.kind === 'INTERIM' && settlement.status === 'COMPLETED')
    .map((settlement) => settlement.lastWorkDate)
    .reduce<string | undefined>((latest, date) => (latest === undefined || date > latest ? date : latest), undefined)
}
