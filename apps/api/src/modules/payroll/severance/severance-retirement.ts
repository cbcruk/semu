/**
 * 정산이 HR의 지금 퇴직과 어긋난 까닭입니다([payroll.md 퇴직금 정산](../../../../../../docs/design/payroll.md#퇴직금-정산)).
 *
 * - `EMPLOYEE_NOT_FOUND`: HR에서 직원을 지웠습니다
 * - `NOT_LEFT`: 퇴사를 취소해 퇴직일이 없습니다
 * - `LEAVE_DATE_CHANGED`: 다시 퇴사해 퇴직일이 정산의 마지막 근무일과 다릅니다
 */
export type RetirementMismatch = 'EMPLOYEE_NOT_FOUND' | 'NOT_LEFT' | 'LEAVE_DATE_CHANGED'

/**
 * 정산을 계산한 마지막 근무일과 HR이 지금 가진 퇴직일을 맞춰 봅니다. 맞으면 `null`입니다.
 *
 * 퇴직금은 퇴직일로 근속기간·평균임금 기간·퇴직월 기준표를 정하므로, 퇴직일이 하루라도 다르면 정산 금액이 맞지 않습니다.
 * `employee`가 `undefined`면 HR에 직원이 없는 것입니다. 입사일은 대조하지 않습니다.
 */
export function retirementMismatchOf(
  lastWorkDate: string,
  employee: { readonly leaveDate: string | null } | undefined,
): RetirementMismatch | null {
  if (employee === undefined) return 'EMPLOYEE_NOT_FOUND'
  const 퇴직일 = employee.leaveDate
  if (퇴직일 === null) return 'NOT_LEFT'
  return 퇴직일 === lastWorkDate ? null : 'LEAVE_DATE_CHANGED'
}
