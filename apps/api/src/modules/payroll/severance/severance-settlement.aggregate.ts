import { Result } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { addDays } from '../../../shared/time/calendar.ts'
import { calculateSeverancePay } from '../engine/severance-pay.ts'
import { resolveRateTable } from '../engine/rate-table.ts'
import type { PayrollRateTable } from '../engine/rate-table.types.ts'
import {
  EmployeeNotFound,
  RateTableNotFound,
  SeveranceInterimDateInvalid,
  SeveranceLaterSettlementCompleted,
  SeveranceNotApplicable,
  SeverancePaymentDateInvalid,
  SeveranceRetirementMismatch,
  SeveranceServiceStartChanged,
  SeveranceSettlementExists,
  SeveranceTransitionInvalid,
  WithholdingFiled,
} from '../payroll-problems.ts'
import type { PayrollEmployee } from '../ports/payroll-employee-directory.ts'
import type { PayrollEvent } from '../ports/payroll-events.types.ts'
import {
  interimDateRange,
  interimRejectionOf,
  kindOf,
  lastCompletedInterimBefore,
  laterCompletedSettlementOf,
  serviceStartDateOf,
} from './severance-interim.ts'
import { retirementMismatchOf } from './severance-retirement.ts'
import {
  type CreateSeveranceSettlement,
  SEVERANCE_TRANSITIONS,
  type SeveranceCommand,
  type SeveranceInputSchema,
  type UpdateSeveranceSettlement,
} from './severance-settlement.ts'
import type { SeveranceSettlementRecord } from './severance-settlement.types.ts'
import { severanceMonthsTouched, severanceWithholdingMonthsChanged } from './severance-withholding.ts'

/**
 * 퇴직금 정산 애그리거트입니다(docs/design/domain-model.md). 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 시각은 `at`으로, 서비스가 읽어 둔 사실(HR 직원·지금 퇴직일, 같은 회사의 정산, 기준표, 원천세가
 * 신고된 지급월)은 인자로 받습니다. 결과는 저장할 정산과 퇴직소득 합계가 바뀐 지급월 이벤트이거나 거부입니다. 이벤트 ID만은
 * 판정 안에서 만듭니다.
 *
 * 중간정산·기산일 규칙(`severance-interim.ts`), 퇴직일 대조(`severance-retirement.ts`), 원천세 지급월(`severance-withholding.ts`),
 * 퇴직금 계산 엔진은 규칙 모듈에 그대로 두고 여기서 부릅니다. 버전 검사(`If-Match`)는 서비스가 맡습니다.
 */

/** 판정 결과입니다. `events`는 `settlement`와 같은 트랜잭션에 냅니다. */
export interface SeveranceDecision {
  settlement: SeveranceSettlementRecord
  events: PayrollEvent[]
}

/** 정산 판정이 함께 받는 사실입니다. `settlements`는 같은 회사의 정산 전체입니다. */
export interface SeveranceFacts {
  settlements: ReadonlyArray<SeveranceSettlementRecord>
  /** 원천세가 신고된 지급월입니다. 서비스는 정산의 지급일 달과 바꾸려는 지급일·마지막 근무일의 달만 물어 채웁니다. */
  filedPaymentMonths: ReadonlySet<string>
}

/** 퇴직금 계산에 쓰는 기준표 전체입니다. 판정이 마지막 근무일 달의 판을 고릅니다. */
export interface SeveranceCalculationFacts {
  rateTables: ReadonlyArray<PayrollRateTable>
}

/** 정산 만들기 입력입니다. */
export type SeveranceCreation = typeof CreateSeveranceSettlement.Type & {
  id: Id<'severanceSettlement'>
  companyId: Id<'company'>
}

/** 정산 만들기를 거부하는 이유입니다. */
export type SeveranceCreationRejection =
  | EmployeeNotFound
  | SeveranceNotApplicable
  | SeveranceInterimDateInvalid
  | SeveranceSettlementExists
  | SeverancePaymentDateInvalid
  | RateTableNotFound
  | WithholdingFiled

/**
 * 정산 만들기를 판정합니다. 퇴직 정산은 퇴사한 직원의 HR 퇴직일까지, 중간정산은 재직 중인 직원의 기준일까지의 퇴직금입니다.
 *
 * 퇴직 정산은 퇴직금 제도 직원만 받고, 같은 마지막 근무일로 제외되지 않은 정산이 있으면 거부합니다. 마지막 완료 중간정산이
 * 퇴직일과 같거나 늦으면 `NO_SERVICE_AFTER_INTERIM`입니다. 근속일수는 기산일(마지막 완료 중간정산 다음 날, 없으면 입사일)부터 셉니다.
 */
export function decideSeveranceCreation(
  input: SeveranceCreation,
  facts: SeveranceFacts & SeveranceCalculationFacts & { employee: PayrollEmployee | undefined; today: string },
  at: string,
): Result.Result<SeveranceDecision, SeveranceCreationRejection> {
  const employee = facts.employee
  if (employee === undefined) return Result.fail(new EmployeeNotFound({}))
  const settlements = facts.settlements.filter((record) => record.employeeId === employee.id)
  let lastWorkDate: string
  let interim: Pick<SeveranceSettlementRecord, 'kind' | 'interimReason'>
  if (input.kind === 'INTERIM') {
    const rejection = interimRejectionOf({
      retirementBenefitType: employee.retirementBenefitType,
      leaveDate: employee.leaveDate,
      joinDate: employee.joinDate,
      settlementDate: input.settlementDate,
      reason: input.interimReason,
      settlements,
      employeeId: employee.id,
    })
    const range = interimDateRange(employee.joinDate, settlements, employee.id, facts.today)
    if (input.settlementDate < range.earliestDate || input.settlementDate > range.latestDate) {
      return Result.fail(new SeveranceInterimDateInvalid(range))
    }
    if (rejection !== null) return Result.fail(new SeveranceNotApplicable({ reason: rejection }))
    // 아직 완료하지 않은 정산이 있으면 그것부터 끝냅니다. 기준일이 엇갈린 계산됨 정산이 둘이면 기산일이 서로를 따라 바뀝니다.
    const open = settlements.find(
      (record) =>
        record.status !== 'EXCLUDED' &&
        (record.status === 'CALCULATED' || record.lastWorkDate === input.settlementDate),
    )
    if (open !== undefined) return Result.fail(new SeveranceSettlementExists({ settlementId: open.id }))
    lastWorkDate = input.settlementDate
    interim = { kind: 'INTERIM', interimReason: input.interimReason }
  } else {
    if (employee.leaveDate === null) return Result.fail(new SeveranceNotApplicable({ reason: 'NOT_LEFT' }))
    if (employee.retirementBenefitType !== 'SEVERANCE_PAY') {
      return Result.fail(new SeveranceNotApplicable({ reason: 'NOT_SEVERANCE_PAY_PLAN' }))
    }
    const leaveDate = employee.leaveDate
    const existing = settlements.find(
      (record) => kindOf(record) === 'RETIREMENT' && record.lastWorkDate === leaveDate && record.status !== 'EXCLUDED',
    )
    if (existing !== undefined) return Result.fail(new SeveranceSettlementExists({ settlementId: existing.id }))
    if (
      lastCompletedInterimBefore(settlements, employee.id, addDays(leaveDate, 1)) !== undefined &&
      serviceStartDateOf(employee.joinDate, settlements, employee.id, addDays(leaveDate, 1)) > leaveDate
    ) {
      return Result.fail(new SeveranceNotApplicable({ reason: 'NO_SERVICE_AFTER_INTERIM' }))
    }
    lastWorkDate = leaveDate
    interim = {}
  }
  const paymentDateRejection = paymentDateRejectionOf(lastWorkDate, input.paymentDate)
  if (paymentDateRejection !== undefined) return Result.fail(paymentDateRejection)
  const serviceStartDate = serviceStartDateOf(employee.joinDate, settlements, employee.id, lastWorkDate)
  const calculated = calculate(employee.joinDate, serviceStartDate, lastWorkDate, input.input, facts)
  if (Result.isFailure(calculated)) return Result.fail(calculated.failure)
  return withWithholding(
    undefined,
    {
      id: input.id,
      companyId: input.companyId,
      employeeId: employee.id,
      employeeName: employee.name,
      kind: interim.kind ?? 'RETIREMENT',
      ...(interim.interimReason === undefined ? {} : { interimReason: interim.interimReason }),
      joinDate: employee.joinDate,
      serviceStartDate,
      lastWorkDate,
      ...(input.paymentDate === undefined ? {} : { paymentDate: input.paymentDate }),
      status: 'CALCULATED',
      input: { ...input.input },
      ...calculated.success,
      version: 1,
      createdAt: at,
      updatedAt: at,
    },
    facts,
  )
}

/**
 * 계산됨 상태에서 입력·지급일 고치기를 판정합니다. 빠진 필드는 그대로 두고, `paymentDate: null`은 지급일을 지웁니다.
 * 다시 계산할 때 기산일도 지금의 완료 중간정산으로 다시 정합니다(`SEVERANCE_SERVICE_START_CHANGED`를 푸는 길).
 */
export function decideSeveranceUpdate(
  record: SeveranceSettlementRecord,
  patch: typeof UpdateSeveranceSettlement.Type,
  facts: SeveranceFacts & SeveranceCalculationFacts,
  at: string,
): Result.Result<
  SeveranceDecision,
  SeveranceTransitionInvalid | SeverancePaymentDateInvalid | RateTableNotFound | WithholdingFiled
> {
  if (record.status !== 'CALCULATED') {
    return Result.fail(new SeveranceTransitionInvalid({ settlementStatus: record.status, action: 'UPDATE' }))
  }
  const input = patch.input ?? record.input
  const { paymentDate: _previous, ...rest } = record
  const paymentDate = patch.paymentDate === undefined ? record.paymentDate : (patch.paymentDate ?? undefined)
  const paymentDateRejection = paymentDateRejectionOf(record.lastWorkDate, paymentDate)
  if (paymentDateRejection !== undefined) return Result.fail(paymentDateRejection)
  const serviceStartDate = serviceStartDateOf(
    record.joinDate,
    facts.settlements,
    record.employeeId,
    record.lastWorkDate,
  )
  const calculated = calculate(record.joinDate, serviceStartDate, record.lastWorkDate, input, facts)
  if (Result.isFailure(calculated)) return Result.fail(calculated.failure)
  return withWithholding(
    record,
    {
      ...rest,
      serviceStartDate,
      ...(paymentDate === undefined ? {} : { paymentDate }),
      input: { ...input },
      ...calculated.success,
      version: record.version + 1,
      updatedAt: at,
    },
    facts,
  )
}

/**
 * 완료·완료 취소·제외·제외 취소를 판정합니다.
 *
 * 완료는 HR의 지금 퇴직일(`leaveDateNow`)과 정산의 마지막 근무일이 맞아야 하고(`SEVERANCE_RETIREMENT_MISMATCH`), 기산일이
 * 저장한 것과 같아야 합니다(`SEVERANCE_SERVICE_START_CHANGED`). 중간정산을 완료하거나 다시 열면 그 뒤 정산의 기산일이 바뀌므로 늦은
 * 정산이 이미 완료됐으면 거부합니다. 완료할 때 지급일이 없으면 마지막 근무일로 채웁니다.
 */
export function decideSeveranceTransition(
  record: SeveranceSettlementRecord,
  command: SeveranceCommand,
  facts: SeveranceFacts & { employeeNow: { readonly leaveDate: string | null } | undefined },
  at: string,
): Result.Result<
  SeveranceDecision,
  | SeveranceTransitionInvalid
  | SeveranceRetirementMismatch
  | SeveranceServiceStartChanged
  | SeveranceLaterSettlementCompleted
  | WithholdingFiled
> {
  const rule = SEVERANCE_TRANSITIONS[command]
  if (record.status !== rule.from) {
    return Result.fail(new SeveranceTransitionInvalid({ settlementStatus: record.status, action: command }))
  }
  const mismatch = retirementMismatchOf(record.lastWorkDate, facts.employeeNow, kindOf(record))
  if (command === 'COMPLETE' && mismatch !== null) {
    return Result.fail(
      new SeveranceRetirementMismatch({
        reason: mismatch,
        lastWorkDate: record.lastWorkDate,
        leaveDate: facts.employeeNow?.leaveDate ?? null,
      }),
    )
  }
  if (command === 'COMPLETE') {
    const serviceStartDate = serviceStartDateOf(
      record.joinDate,
      facts.settlements,
      record.employeeId,
      record.lastWorkDate,
    )
    if (serviceStartDate !== (record.serviceStartDate ?? record.joinDate)) {
      return Result.fail(new SeveranceServiceStartChanged({ serviceStartDate }))
    }
  }
  if (command === 'COMPLETE' || command === 'REOPEN') {
    const later = kindOf(record) === 'INTERIM' ? laterCompletedSettlementOf(facts.settlements, record) : undefined
    if (later !== undefined) return Result.fail(new SeveranceLaterSettlementCompleted({ settlementId: later.id }))
  }
  return withWithholding(
    record,
    {
      ...record,
      // 현행 `complete`처럼 지급일이 없으면 마지막 근무일로 채웁니다. 그래서 완료된 정산은 모두 지급월이 있습니다.
      ...(command === 'COMPLETE' && record.paymentDate === undefined ? { paymentDate: record.lastWorkDate } : {}),
      status: rule.to,
      version: record.version + 1,
      updatedAt: at,
    },
    facts,
  )
}

/**
 * 지급일이 마지막 근무일(중간정산은 기준일)보다 앞서면 거부합니다. 퇴직금은 퇴직·중간정산으로 생기는 지급이라 그 전에 줄 수
 * 없습니다. 당일은 받습니다.
 */
function paymentDateRejectionOf(
  lastWorkDate: string,
  paymentDate: string | undefined,
): SeverancePaymentDateInvalid | undefined {
  return paymentDate !== undefined && paymentDate < lastWorkDate
    ? new SeverancePaymentDateInvalid({ lastWorkDate })
    : undefined
}

/**
 * 원천세와 맞춥니다. 건드린 지급월({@link severanceMonthsTouched}) 중 신고된 달이 있으면 거부하고, 퇴직소득 합계가 바뀐 지급월마다
 * `payroll_pay_month.withholding_changed`를 냅니다. 급여대장과 같은 잠금입니다.
 */
function withWithholding(
  before: SeveranceSettlementRecord | undefined,
  next: SeveranceSettlementRecord,
  facts: SeveranceFacts,
): Result.Result<SeveranceDecision, WithholdingFiled> {
  const filed = severanceMonthsTouched(before, next).find((month) => facts.filedPaymentMonths.has(month))
  if (filed !== undefined) return Result.fail(new WithholdingFiled({ paymentMonth: filed }))
  return Result.succeed({
    settlement: next,
    events: severanceWithholdingMonthsChanged(before, next).map((paymentMonth) => ({
      type: 'payroll_pay_month.withholding_changed',
      eventId: newId('event'),
      companyId: next.companyId,
      paymentMonth,
      occurredAt: next.updatedAt,
    })),
  })
}

/** 마지막 근무일 달의 기준표로 퇴직금과 퇴직소득세를 계산합니다. */
function calculate(
  joinDate: string,
  serviceStartDate: string,
  lastWorkDate: string,
  input: typeof SeveranceInputSchema.Type,
  facts: SeveranceCalculationFacts,
): Result.Result<Pick<SeveranceSettlementRecord, 'result' | 'rateTable'>, RateTableNotFound> {
  const month = lastWorkDate.slice(0, 7)
  let rates: PayrollRateTable
  try {
    rates = resolveRateTable(facts.rateTables, month as Parameters<typeof resolveRateTable>[1])
  } catch {
    return Result.fail(new RateTableNotFound({ month }))
  }
  return Result.succeed({
    result: calculateSeverancePay({ joinDate, serviceStartDate, lastWorkDate, ...input }, rates),
    rateTable: rates.effectiveFrom,
  })
}
