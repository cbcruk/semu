import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { CalendarDate, Won } from '../payroll-schema.ts'
import type { RetirementMismatch } from './severance-retirement.ts'
import type { SeveranceSettlementRecord, SeveranceStatus } from './severance-settlement.types.ts'

/** 퇴직금 계산 입력입니다. 입사일·마지막 근무일은 HR에서 받습니다. */
export const SeveranceInputSchema = Schema.Struct({
  /** 퇴직일 이전 3개 역월에 지급한 임금입니다. */
  threeMonthWages: Won,
  /** 그 3개월의 일수입니다. 없으면 달력으로 셉니다. */
  threeMonthDays: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)))),
  /** 최근 12개월 상여 총액입니다. 3/12을 더합니다. */
  annualBonus: Schema.optionalKey(Won),
  /** 전년도 미사용 연차수당입니다. 3/12을 더합니다. */
  annualLeavePay: Schema.optionalKey(Won),
  /** 1일 통상임금입니다. 평균임금보다 높으면 이것을 씁니다. */
  ordinaryDailyWage: Schema.optionalKey(Won),
})

/** 중간정산 사유입니다(근로자퇴직급여 보장법 시행령 제3조제1항). */
export const InterimSettlementReasonSchema = Schema.Literals([
  'HOME_PURCHASE',
  'RENT_DEPOSIT',
  'MEDICAL_TREATMENT',
  'BANKRUPTCY',
  'PERSONAL_REHABILITATION',
  'WAGE_PEAK',
  'WORK_HOURS_REDUCTION',
  'LEGAL_WORK_HOURS_REDUCTION',
  'GOVERNMENT_NOTICE',
])

/** 퇴직 정산 만들기입니다. 마지막 근무일은 HR 퇴직일입니다. `kind`를 빼면 퇴직 정산입니다. */
const CreateRetirementSettlement = Schema.Struct({
  kind: Schema.optionalKey(Schema.Literal('RETIREMENT')),
  employeeId: IdSchema('employee'),
  input: SeveranceInputSchema,
  /** 퇴직금 지급일입니다. 없으면 완료할 때 마지막 근무일로 채웁니다. */
  paymentDate: Schema.optionalKey(CalendarDate),
})

/** 재직 중 중간정산 만들기입니다. 기준일(`settlementDate`)까지의 퇴직금을 정산합니다. */
const CreateInterimSettlement = Schema.Struct({
  kind: Schema.Literal('INTERIM'),
  employeeId: IdSchema('employee'),
  /** 정산 기준일입니다. 마지막 완료 중간정산 다음 날부터 오늘까지입니다. 그 다음 정산의 기산일은 이 날의 다음 날입니다. */
  settlementDate: CalendarDate,
  interimReason: InterimSettlementReasonSchema,
  input: SeveranceInputSchema,
  /** 지급일입니다. 기준일보다 앞설 수 없고, 없으면 완료할 때 기준일로 채웁니다. */
  paymentDate: Schema.optionalKey(CalendarDate),
})

/** `POST /severance-settlements` 본문입니다. 퇴직 정산과 중간정산입니다. */
export const CreateSeveranceSettlement = Schema.Union([CreateRetirementSettlement, CreateInterimSettlement])

/**
 * `PATCH /severance-settlements/{id}` 본문입니다. 빠진 필드는 그대로 둡니다.
 * `paymentDate: null`은 지급일을 지웁니다(완료할 때 다시 마지막 근무일로 채움).
 */
export const UpdateSeveranceSettlement = Schema.Struct({
  input: Schema.optionalKey(SeveranceInputSchema),
  paymentDate: Schema.optionalKey(Schema.NullOr(CalendarDate)),
})

const Status = Schema.Literals(['CALCULATED', 'COMPLETED', 'EXCLUDED'])

/** 퇴직금 정산 응답입니다. */
export const SeveranceSettlement = Schema.Struct({
  id: IdSchema('severanceSettlement'),
  employeeId: IdSchema('employee'),
  employeeName: Schema.String,
  /** 정산 종류입니다. 퇴직(`RETIREMENT`)과 재직 중 중간정산(`INTERIM`)입니다. */
  kind: Schema.Literals(['RETIREMENT', 'INTERIM']),
  /** 중간정산 사유입니다. 퇴직 정산이면 `null`입니다. */
  interimReason: Schema.NullOr(InterimSettlementReasonSchema),
  joinDate: Schema.String,
  /** 계속근로기간의 기산일입니다. 마지막 완료 중간정산의 다음 날이고, 없으면 입사일입니다. 근속일수를 여기서 셉니다. */
  serviceStartDate: Schema.String,
  /** 마지막 근무일입니다. 중간정산이면 정산 기준일입니다. */
  lastWorkDate: Schema.String,
  /** 퇴직금 지급일입니다. 원천세 퇴직소득 그 외(A22)의 지급월입니다. 아직 정하지 않았거나 이 필드 전에 저장한 정산이면 `null`입니다. */
  paymentDate: Schema.NullOr(Schema.String),
  status: Status,
  /**
   * HR의 지금 퇴직과 어긋난 까닭입니다. 맞으면 `null`입니다. 저장하지 않고 읽을 때마다 HR 퇴직일과 대조합니다.
   * 어긋난 정산은 `:complete`가 409 `SEVERANCE_RETIREMENT_MISMATCH`이고 `allowedActions`에 `COMPLETE`가 없습니다.
   */
  retirementMismatch: Schema.NullOr(
    Schema.Literals(['EMPLOYEE_NOT_FOUND', 'NOT_LEFT', 'LEAVE_DATE_CHANGED', 'LEFT_BEFORE_INTERIM']),
  ),
  input: SeveranceInputSchema,
  result: Schema.Struct({
    eligible: Schema.Boolean,
    serviceDays: Schema.Int,
    averageDailyWage: Schema.Int,
    usedOrdinaryWage: Schema.Boolean,
    severancePay: Schema.Int,
    retirementIncomeTax: Schema.Int,
    localIncomeTax: Schema.Int,
    netPay: Schema.Int,
    breakdown: Schema.Array(
      Schema.Struct({ code: Schema.String, label: Schema.String, amount: Schema.Int, formula: Schema.String }),
    ),
  }),
  /** 퇴직소득세에 쓴 기준표(퇴직월)입니다. */
  rateTable: Schema.String,
  allowedActions: Schema.Array(Schema.Literals(['UPDATE', 'COMPLETE', 'REOPEN', 'EXCLUDE', 'INCLUDE'])),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/** 퇴직금 정산 커맨드입니다. */
export type SeveranceCommand = 'COMPLETE' | 'REOPEN' | 'EXCLUDE' | 'INCLUDE'

/** 퇴직금 정산 전이표입니다. 계산됨에서만 입력을 고치고, 완료·제외는 되돌릴 수 있습니다. */
export const SEVERANCE_TRANSITIONS: Record<SeveranceCommand, { from: SeveranceStatus; to: SeveranceStatus }> = {
  COMPLETE: { from: 'CALCULATED', to: 'COMPLETED' },
  REOPEN: { from: 'COMPLETED', to: 'CALCULATED' },
  EXCLUDE: { from: 'CALCULATED', to: 'EXCLUDED' },
  INCLUDE: { from: 'EXCLUDED', to: 'CALCULATED' },
}

/** 상세 응답의 `allowedActions`입니다. HR 퇴직과 어긋난 정산은 완료할 수 없어 `COMPLETE`를 뺍니다. */
export function severanceActions(
  status: SeveranceStatus,
  retirementMismatch: RetirementMismatch | null,
): Array<'UPDATE' | SeveranceCommand> {
  const commands = (Object.keys(SEVERANCE_TRANSITIONS) as SeveranceCommand[]).filter(
    (command) =>
      SEVERANCE_TRANSITIONS[command].from === status && !(command === 'COMPLETE' && retirementMismatch !== null),
  )
  return status === 'CALCULATED' ? ['UPDATE', ...commands] : commands
}

/** 레코드와 읽을 때 대조한 HR 퇴직 어긋남으로 응답을 만듭니다. */
export function severanceResponse(
  record: SeveranceSettlementRecord,
  retirementMismatch: RetirementMismatch | null,
): typeof SeveranceSettlement.Type {
  return {
    ...record,
    kind: record.kind ?? 'RETIREMENT',
    interimReason: record.interimReason ?? null,
    serviceStartDate: record.serviceStartDate ?? record.joinDate,
    paymentDate: record.paymentDate ?? null,
    retirementMismatch,
    allowedActions: severanceActions(record.status, retirementMismatch),
  }
}

/** 퇴직금 정산 후보 한 명입니다. 퇴사했고 퇴직금 제도인데 그 퇴직의 정산이 없는 직원입니다. */
export const SeveranceSettlementCandidate = Schema.Struct({
  employeeId: IdSchema('employee'),
  employeeName: Schema.String,
  joinDate: Schema.String,
  leaveDate: Schema.String,
  /** 계속근로기간의 기산일입니다. 마지막 완료 중간정산의 다음 날이고, 없으면 입사일입니다. */
  serviceStartDate: Schema.String,
  /** 입사일부터 퇴직일까지 1년 이상이라 퇴직금이 있는지입니다. 아니면 정산을 만들어도 0원입니다. */
  eligible: Schema.Boolean,
})
