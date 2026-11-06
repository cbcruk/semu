import { LegacyFields } from '../legacy-body.ts'
import { LegacyError, legacyErrors } from '../legacy-error.ts'
import type { Employee, Resignation } from '../upstream.types.ts'

/**
 * 현행 퇴직 정보(`retirement-info/`)입니다. 새 API에서는 직원의 `resignation`과 `severanceSettlementStatus`입니다.
 *
 * 퇴직금 제도·중간정산·퇴직금은 새 API에 자리가 없어 현행 기본값(`grant`, 중간정산 없음, `null`)입니다.
 * `updated`는 퇴직이 있을 때 직원의 `updatedAt`입니다(현행은 퇴직 정보 행의 수정 시각).
 */
export function toLegacyRetirement(employee: Employee): Record<string, unknown> {
  const resignation = employee.resignation
  return {
    retirement_benefit_type: 'grant',
    has_interim_settlement: false,
    interim_settlement_date: null,
    interim_settlement_reason: null,
    leave_date: resignation?.leaveDate ?? null,
    leaving_reason: resignation?.leavingReasonCode ?? null,
    leaving_detail_reason: resignation?.leavingDetailReasonCode ?? null,
    severance_amount: null,
    severance_settlement_status: employee.severanceSettlementStatus?.toLowerCase() ?? null,
    updated: resignation === undefined ? null : employee.updatedAt,
  }
}

/** 현행 퇴직 정보 본문에서 새 API로 옮길 변경입니다. */
export type RetirementChange =
  /** 바뀐 것이 없습니다. */
  | { kind: 'none' }
  /** 퇴직을 등록하거나 고칩니다(`:resign`). `leaveDateChanged`면 현행처럼 `If-Match`가 있어야 합니다. */
  | { kind: 'resign'; resignation: Resignation; leaveDateChanged: boolean }
  /** 퇴직일을 지워 퇴직을 취소합니다(`:cancel-resignation`). */
  | { kind: 'cancel' }

/**
 * 현행 퇴직 정보 본문(`PUT retirement-info/`)을 지금 직원과 비교해 할 일을 정합니다.
 *
 * 퇴직금 제도(`grant` 밖), 중간정산, 퇴직금은 새 API에 자리가 없어 기본값이 아니면 422입니다.
 * 퇴직일 없이 사유만 저장하는 것도 새 API에서는 할 수 없어 422입니다.
 */
export function retirementChange(employee: Employee, body: Record<string, unknown>): RetirementChange {
  const fields = new LegacyFields(body)
  fields.choice('retirement_benefit_type', ['grant', 'pension_db', 'pension_dc'], 'grant')
  fields.unsupported('retirement_benefit_type', 'grant')
  fields.unsupported('has_interim_settlement', false)
  fields.unsupported('interim_settlement_date')
  fields.unsupported('interim_settlement_reason')
  fields.unsupported('severance_amount')
  const leaveDate = fields.optionalDate('leave_date')
  const reason = fields.optionalText('leaving_reason')
  const detail = fields.optionalText('leaving_detail_reason')
  const current = employee.resignation
  if (leaveDate === null) {
    if (reason !== null) throw legacyErrors.invalidField('leaving_reason', 'Not supported by the new API yet.')
    return current === undefined ? { kind: 'none' } : { kind: 'cancel' }
  }
  if (reason === null) throw legacyErrors.invalidField('leaving_reason', 'Choose the leaving reason.')
  const unchanged =
    current !== undefined &&
    current.leaveDate === leaveDate &&
    current.leavingReasonCode === reason &&
    (current.leavingDetailReasonCode ?? null) === detail
  if (unchanged) return { kind: 'none' }
  return {
    kind: 'resign',
    resignation: {
      leaveDate,
      leavingReasonCode: reason,
      ...(detail === null ? {} : { leavingDetailReasonCode: detail }),
    },
    leaveDateChanged: current?.leaveDate !== leaveDate,
  }
}

/**
 * 새 API의 퇴직 거절(`RESIGNATION_REJECTED`)을 현행 필드 오류로 바꿉니다. 현행 서버와 같은 문구입니다.
 * 다른 오류는 그대로 둡니다.
 */
export function toLegacyResignationError(error: unknown): unknown {
  if (!(error instanceof LegacyError) || error.body.code !== 'RESIGNATION_REJECTED') return error
  switch (error.body['reason']) {
    case 'LEAVE_DATE_BEFORE_JOIN':
      return legacyErrors.invalidField('leave_date', 'The leave date cannot be before the join date.')
    case 'LEAVING_REASON_INVALID':
      return legacyErrors.invalidField('leaving_reason', 'Unknown leaving reason or detail reason.')
    default:
      return error
  }
}
