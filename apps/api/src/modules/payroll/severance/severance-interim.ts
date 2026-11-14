import { addDays, daysBetween } from '../../../shared/time/calendar.ts'
import type { SeveranceKind, SeveranceSettlementRecord } from './severance-settlement.types.ts'

/** 기산일·중간정산 판정에 쓰는 정산의 일부입니다. */
export type SettlementFact = Pick<
  SeveranceSettlementRecord,
  'id' | 'employeeId' | 'kind' | 'interimReason' | 'status' | 'lastWorkDate'
>

/** 정산 종류입니다. 이 필드가 생기기 전에 저장한 정산은 퇴직입니다. */
export function kindOf(settlement: Pick<SeveranceSettlementRecord, 'kind'>): SeveranceKind {
  return settlement.kind ?? 'RETIREMENT'
}

/**
 * 그 직원이 `before` 전에 완료한 마지막 중간정산의 기준일입니다. 없으면 `undefined`입니다.
 *
 * 중간정산은 그날까지의 퇴직금을 미리 준 것이라, 그 뒤 정산의 계속근로기간은 다음 날부터 셉니다(근로자퇴직급여 보장법 제8조제2항).
 * 계산됨·제외 중간정산은 아직 주지 않았거나 하지 않기로 한 것이라 세지 않습니다.
 */
export function lastCompletedInterimBefore(
  settlements: readonly SettlementFact[],
  employeeId: SeveranceSettlementRecord['employeeId'],
  before: string,
): string | undefined {
  return settlements
    .filter(
      (settlement) =>
        settlement.employeeId === employeeId &&
        kindOf(settlement) === 'INTERIM' &&
        settlement.status === 'COMPLETED' &&
        settlement.lastWorkDate < before,
    )
    .map((settlement) => settlement.lastWorkDate)
    .reduce<string | undefined>((latest, date) => (latest === undefined || date > latest ? date : latest), undefined)
}

/** 계속근로기간의 기산일입니다. 마지막 완료 중간정산의 다음 날이고, 없으면 입사일입니다. */
export function serviceStartDateOf(
  joinDate: string,
  settlements: readonly SettlementFact[],
  employeeId: SeveranceSettlementRecord['employeeId'],
  lastWorkDate: string,
): string {
  const 중간정산일 = lastCompletedInterimBefore(settlements, employeeId, lastWorkDate)
  return 중간정산일 === undefined ? joinDate : addDays(중간정산일, 1)
}

/** 중간정산을 만들 수 없는 직원의 까닭입니다. */
export type InterimRejection =
  'NOT_SEVERANCE_PAY_PLAN' | 'ALREADY_LEFT' | 'SERVICE_UNDER_ONE_YEAR' | 'RENT_DEPOSIT_ALREADY_USED'

/**
 * 중간정산을 만들 수 있는지 판정합니다. 만들 수 있으면 `null`입니다. 검사 순서는 제도, 퇴직, 근속 1년, 전세 1회입니다.
 *
 * - 퇴직금 제도(`SEVERANCE_PAY`) 직원만 받습니다. 퇴직연금은 중도인출이라 다른 절차입니다
 * - 이미 퇴사한 직원은 퇴직 정산을 합니다
 * - 입사일부터 기준일까지(양 끝 포함) 365일 미만이면 받을 퇴직금이 없습니다
 * - 무주택자 전세금·보증금 사유는 한 사업에서 1회입니다(시행령 제3조제1항제2호). 제외하지 않은 같은 사유 중간정산이 있으면 거절합니다
 */
export function interimRejectionOf(input: {
  readonly retirementBenefitType: string
  readonly leaveDate: string | null
  readonly joinDate: string
  readonly settlementDate: string
  readonly reason: SeveranceSettlementRecord['interimReason']
  readonly settlements: readonly SettlementFact[]
  readonly employeeId: SeveranceSettlementRecord['employeeId']
}): InterimRejection | null {
  if (input.retirementBenefitType !== 'SEVERANCE_PAY') return 'NOT_SEVERANCE_PAY_PLAN'
  if (input.leaveDate !== null) return 'ALREADY_LEFT'
  if (daysBetween(input.joinDate, input.settlementDate) + 1 < 365) return 'SERVICE_UNDER_ONE_YEAR'
  const 전세사용 =
    input.reason === 'RENT_DEPOSIT' &&
    input.settlements.some(
      (settlement) =>
        settlement.employeeId === input.employeeId &&
        kindOf(settlement) === 'INTERIM' &&
        settlement.interimReason === 'RENT_DEPOSIT' &&
        settlement.status !== 'EXCLUDED',
    )
  return 전세사용 ? 'RENT_DEPOSIT_ALREADY_USED' : null
}

/**
 * 중간정산 기준일로 받을 수 있는 범위입니다. 마지막 완료 중간정산 다음 날(없으면 입사일)부터 오늘까지입니다.
 *
 * 앞으로의 날은 아직 생기지 않은 퇴직금이라 받지 않습니다. 완료한 중간정산 이전 날은 이미 정산한 기간입니다.
 */
export function interimDateRange(
  joinDate: string,
  settlements: readonly SettlementFact[],
  employeeId: SeveranceSettlementRecord['employeeId'],
  today: string,
): { earliestDate: string; latestDate: string } {
  const 중간정산일 = lastCompletedInterimBefore(settlements, employeeId, addDays(today, 1))
  return { earliestDate: 중간정산일 === undefined ? joinDate : addDays(중간정산일, 1), latestDate: today }
}

/**
 * 이 정산보다 기준일이 늦은 완료 정산입니다. 없으면 `undefined`입니다.
 *
 * 완료한 정산은 그 앞의 완료 중간정산으로 기산일을 정했습니다. 그래서 그보다 앞선 중간정산을 새로 완료하거나 다시 열면
 * 늦은 정산의 기산일과 금액이 틀어집니다. 중간정산의 `:complete`·`:reopen`이 이것으로 막습니다.
 */
export function laterCompletedSettlementOf(
  settlements: readonly SettlementFact[],
  target: SettlementFact,
): SettlementFact | undefined {
  return settlements.find(
    (settlement) =>
      settlement.id !== target.id &&
      settlement.employeeId === target.employeeId &&
      settlement.status === 'COMPLETED' &&
      settlement.lastWorkDate > target.lastWorkDate,
  )
}
