import { Result } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { daysBetween } from '../../../shared/time/calendar.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { ActorKind } from '../../identity-access/actor.types.ts'
import type { EarnerRecord } from '../earners/earner.ts'
import { resolveRateTable } from '../engine/rate-table.ts'
import type { PayrollRateTable } from '../engine/rate-table.types.ts'
import { defaultRowItems, rowItemViolations } from '../items/payroll-item-rules.ts'
import type { PayrollItemCatalog } from '../items/payroll-item.types.ts'
import {
  AdditionalLedgerBlocked,
  EmployeeNotFound,
  PayrollLedgerHasAdditional,
  PayrollLedgerReadOnly,
  PayrollLedgerTransitionInvalid,
  PayrollRowItemInvalid,
  PayrollRowNotFound,
  PayrollRowPayeeInvalid,
  RateTableNotFound,
  WageIncomeDuplicated,
  WageRowOnAdditionalLedger,
  WithholdingFiled,
} from '../payroll-problems.ts'
import type { PayrollEmployee } from '../ports/payroll-employee-directory.ts'
import type { PayrollEvent } from '../ports/payroll-events.types.ts'
import type { EmployeeSnapshot, PayrollRowInputValue } from '../rows/payroll-row-input.ts'
import { calculateRow } from '../rows/row-calculation.ts'
import type { PayrollSettingRecord } from '../settings/payroll-setting.types.ts'
import {
  additionalLedgerBlocker,
  defaultPaymentDate,
  duplicatedWageIncome,
  paymentMonthOf,
  wagePeriodOf,
} from './ledger-rules.ts'
import { canEditInput, decideTransition } from './ledger-status.ts'
import type { LedgerTransition } from './ledger-status.types.ts'
import { ledgerMonthsTouched, payMonthChanges } from './pay-month.ts'
import type { PayrollEarner, PayrollLedgerRecord, PayrollRowRecord } from './payroll-ledger.types.ts'

/**
 * 급여대장(행 포함) 애그리거트입니다(docs/design/domain-model.md). 커맨드 입력, 거부, 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 저장소·권한·시계를 모르고, 시각과 행위자는 {@link LedgerDecisionContext}로, 서비스가 읽어 둔
 * 사실(같은 회사의 대장, 기준표·설정·항목 카탈로그, 원천세가 신고된 지급월, HR 직원·소득자 명부)은 인자로 받습니다. 결과는 저장할
 * 대장과 그 변경이 낸 지급월 이벤트이거나 거부입니다. 새 행 ID와 이벤트 ID만은 판정 안에서 만들어 같은 입력에도 다릅니다.
 *
 * 전이표(`ledger-status.ts`), 대장 날짜·추가 대장 규칙(`ledger-rules.ts`), 지급월 마감(`pay-month.ts`), 행 계산
 * (`row-calculation.ts`)은 규칙 모듈에 그대로 두고 여기서 부릅니다. 버전 검사(`If-Match`)는 동시성 규칙이라 서비스가 맡습니다.
 */

/** 사람이 보낸 커맨드의 판정이 받는 시각과 행위자입니다. 대장은 행위자 종류(고객·대리인)만 봅니다. */
export interface LedgerDecisionContext {
  /** 커맨드를 처리하는 시각입니다(RFC 3339). */
  at: string
  actor: { kind: ActorKind }
}

/** 판정 결과입니다. `events`는 `ledger`와 같은 트랜잭션에 냅니다. */
export interface LedgerDecision {
  ledger: PayrollLedgerRecord
  events: PayrollEvent[]
}

/** 행 계산에 쓰는 사실입니다. 기준표는 코드에 컴파일된 참조 데이터 전체이고, 판정이 귀속월·지급월의 판을 고릅니다. */
export interface LedgerCalculationFacts {
  rateTables: ReadonlyArray<PayrollRateTable>
  setting: PayrollSettingRecord
  catalog: PayrollItemCatalog
}

/** 대장 판정이 함께 받는 사실입니다. `ledgers`는 같은 회사의 대장 전체(판정 대상 포함, 바뀌기 전)입니다. */
export interface LedgerFacts {
  ledgers: ReadonlyArray<PayrollLedgerRecord>
  /** 원천세가 신고된 지급월입니다. 서비스는 커맨드가 건드릴 수 있는 지급월만 물어 채웁니다. */
  filedPaymentMonths: ReadonlySet<string>
}

/** 입력을 고치는 커맨드(머리 수정·행 쓰기·다시 계산)가 공통으로 거부하는 이유입니다. */
export type LedgerEditRejection = PayrollLedgerReadOnly | WithholdingFiled

/** 대장 만들기 입력입니다. */
export interface LedgerCreation {
  id: Id<'payrollLedger'>
  companyId: Id<'company'>
  attributionMonth: string
  paymentDate?: string | undefined
  title?: string | undefined
}

/**
 * 대장 만들기의 종류와 지급일입니다. 귀속월의 첫 대장이 정기 대장이고, 지급일을 주지 않으면 추가 대장은 정기 대장의 지급일을,
 * 정기 대장은 설정의 기본 지급일을 씁니다. 서비스는 이것으로 신고 잠금을 물을 지급월과 HR 근로소득자를 읽을지를 정합니다.
 */
export function planLedgerCreation(
  input: Pick<LedgerCreation, 'attributionMonth' | 'paymentDate'>,
  ledgers: ReadonlyArray<PayrollLedgerRecord>,
  setting: PayrollSettingRecord,
): { kind: 'REGULAR' | 'ADDITIONAL'; paymentDate: string; wagePeriod: { start: string; end: string } } {
  const sameMonth = ledgers.filter((ledger) => ledger.attributionMonth === input.attributionMonth)
  const regular = sameMonth.find((ledger) => ledger.kind === 'REGULAR')
  return {
    kind: sameMonth.length === 0 ? 'REGULAR' : 'ADDITIONAL',
    paymentDate: input.paymentDate ?? regular?.paymentDate ?? defaultPaymentDate(input.attributionMonth, setting),
    wagePeriod: wagePeriodOf(input.attributionMonth, setting.wagePeriodStartDay),
  }
}

/**
 * 대장 만들기를 판정합니다. 추가 대장은 추가 대장 규칙({@link additionalLedgerBlocker})을, 정기 대장은 신고 잠금을 통과해야 합니다.
 * 정기 대장은 `wageEarners`(임금산정 기간에 재직한 HR 근로소득자)로 근로 행을 채우고 모든 행을 계산합니다.
 *
 * 행위자는 보지 않아 정기 작업의 자동 생성도 같은 판정을 씁니다(시각만 받음).
 */
export function decideLedgerCreation(
  input: LedgerCreation,
  facts: LedgerFacts & LedgerCalculationFacts & { wageEarners: ReadonlyArray<PayrollEmployee> },
  at: string,
): Result.Result<LedgerDecision, AdditionalLedgerBlocked | WithholdingFiled | RateTableNotFound> {
  const plan = planLedgerCreation(input, facts.ledgers, facts.setting)
  const paymentMonth = paymentMonthOf(plan.paymentDate)
  const filed = facts.filedPaymentMonths.has(paymentMonth)
  if (plan.kind === 'ADDITIONAL') {
    const blocker = additionalLedgerBlocker({
      attributionMonth: input.attributionMonth,
      paymentDate: plan.paymentDate,
      today: companyDate(Date.parse(at)),
      ledgers: facts.ledgers,
      withholdingFiled: filed,
    })
    if (blocker === 'WITHHOLDING_FILED') return Result.fail(new WithholdingFiled({ paymentMonth }))
    if (blocker !== null) return Result.fail(new AdditionalLedgerBlocked({ reason: blocker }))
  } else if (filed) {
    return Result.fail(new WithholdingFiled({ paymentMonth }))
  }
  const employees = plan.kind === 'REGULAR' ? facts.wageEarners : []
  const [year, month] = input.attributionMonth.split('-')
  const draft: PayrollLedgerRecord = {
    id: input.id,
    companyId: input.companyId,
    kind: plan.kind,
    workflow: facts.setting.workflow,
    status: 'DRAFT',
    title: input.title ?? `${year}년 ${Number(month)}월 ${plan.kind === 'REGULAR' ? '급여' : '추가 급여'}`,
    attributionMonth: input.attributionMonth,
    paymentDate: plan.paymentDate,
    wagePeriod: plan.wagePeriod,
    rows: employees.map((employee) => ({
      id: newId('payrollRow'),
      employeeId: employee.id,
      earnerId: null,
      payeeName: employee.name,
      earner: earnerOf(employee),
      input: initialWageInput(employee, plan.wagePeriod, facts.catalog),
      snapshot: snapshotOf(employee),
      result: null,
      updatedAt: at,
    })),
    rejection: null,
    reopenReason: null,
    calculatedAt: null,
    closedAt: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  }
  return Result.map(calculateLedger(draft, facts, at), (ledger) => decided(facts.ledgers, ledger, at))
}

/**
 * 대장 머리(제목·지급일) 고치기를 판정합니다. 신고 잠금은 변경이 건드리는 지급월({@link ledgerMonthsTouched})을 봅니다.
 * 지급월이 바뀌면 지급월 기준표로 모든 행을 다시 계산합니다.
 */
export function decideLedgerHeaderUpdate(
  ledger: PayrollLedgerRecord,
  patch: { title?: string; paymentDate?: string },
  facts: LedgerFacts & LedgerCalculationFacts,
  context: LedgerDecisionContext,
): Result.Result<LedgerDecision, LedgerEditRejection | RateTableNotFound> {
  if (!canEditInput(ledger.status, context.actor.kind)) {
    return Result.fail(new PayrollLedgerReadOnly({ ledgerStatus: ledger.status }))
  }
  const next: PayrollLedgerRecord = { ...ledger, ...patch, version: ledger.version + 1, updatedAt: context.at }
  const filed = firstFiled(facts, ledgerMonthsTouched(ledger, next))
  if (filed !== undefined) return Result.fail(filed)
  const calculated =
    paymentMonthOf(next.paymentDate) === paymentMonthOf(ledger.paymentDate)
      ? Result.succeed(next)
      : calculateLedger(next, facts, context.at)
  return Result.map(calculated, (result) => decided(facts.ledgers, result, context.at))
}

/** 대장 지우기를 판정합니다. 입력 중(`DRAFT`)인 대장만 지우고, 추가 대장이 딸린 정기 대장은 추가 대장을 먼저 지워야 합니다. */
export function decideLedgerDeletion(
  ledger: PayrollLedgerRecord,
  facts: LedgerFacts,
  context: LedgerDecisionContext,
): Result.Result<
  { events: PayrollEvent[] },
  LedgerEditRejection | PayrollLedgerTransitionInvalid | PayrollLedgerHasAdditional
> {
  const rejected = editRejection(ledger, facts, context)
  if (rejected !== undefined) return Result.fail(rejected)
  if (ledger.status !== 'DRAFT') {
    return Result.fail(new PayrollLedgerTransitionInvalid({ ledgerStatus: ledger.status, action: 'DELETE' }))
  }
  if (
    ledger.kind === 'REGULAR' &&
    facts.ledgers.some((other) => other.id !== ledger.id && other.attributionMonth === ledger.attributionMonth)
  ) {
    return Result.fail(new PayrollLedgerHasAdditional({}))
  }
  const after = facts.ledgers.filter((other) => other.id !== ledger.id)
  return Result.succeed({ events: payMonthEvents(ledger.companyId, facts.ledgers, after, context.at) })
}

/** 행 추가 입력입니다. 직원이나 소득자 명부의 소득자 중 하나를 가리킵니다. */
export interface RowAddition {
  employeeId?: Id<'employee'> | undefined
  earnerId?: Id<'earner'> | undefined
  input: PayrollRowInputValue
}

/** 행 추가가 받는 소득자 사실입니다. 서비스가 입력이 가리키는 직원(HR)과 소득자(명부)를 읽어 둡니다. 없으면 `undefined`입니다. */
export interface PayeeFacts {
  employee: PayrollEmployee | undefined
  earner: EarnerRecord | undefined
}

/** 행 추가·수정이 거부하는 이유입니다. */
export type RowWriteRejection =
  | LedgerEditRejection
  | WageRowOnAdditionalLedger
  | PayrollRowPayeeInvalid
  | EmployeeNotFound
  | WageIncomeDuplicated
  | PayrollRowItemInvalid
  | PayrollRowNotFound
  | RateTableNotFound

/**
 * 행 추가를 판정합니다. 근로 행은 정기 대장에만, 직원·귀속월마다 하나만 넣을 수 있습니다. 그 밖의 행은 직원이나 소득자 명부의
 * 소득자 중 하나를 가리킵니다. 이름과 소득자 사본은 직원이면 HR에서, 소득자면 명부에서 복사하고 모든 행을 다시 계산합니다.
 */
export function decideRowAddition(
  ledger: PayrollLedgerRecord,
  input: RowAddition,
  facts: LedgerFacts & LedgerCalculationFacts & PayeeFacts,
  context: LedgerDecisionContext,
): Result.Result<LedgerDecision & { row: PayrollRowRecord }, RowWriteRejection> {
  const rejected = editRejection(ledger, facts, context)
  if (rejected !== undefined) return Result.fail(rejected)
  const payee = payeeOf(ledger, input, facts)
  if (Result.isFailure(payee)) return Result.fail(payee.failure)
  const violations = rowItemViolations(input.input, undefined, facts.catalog)
  if (violations.length > 0) return Result.fail(new PayrollRowItemInvalid({ violations }))
  const row: PayrollRowRecord = {
    id: newId('payrollRow'),
    ...payee.success,
    input: input.input,
    result: null,
    updatedAt: context.at,
  }
  const next = { ...ledger, rows: [...ledger.rows, row], version: ledger.version + 1, updatedAt: context.at }
  return Result.map(calculateLedger(next, facts, context.at), (calculated) => ({
    ...decided(facts.ledgers, calculated, context.at),
    row: calculated.rows.at(-1) ?? row,
  }))
}

/** 행 입력 고치기를 판정합니다. 소득 구분은 바꿀 수 없고, 소득자는 행을 다시 넣어야 바뀝니다. 모든 행을 다시 계산합니다. */
export function decideRowUpdate(
  ledger: PayrollLedgerRecord,
  rowId: Id<'payrollRow'>,
  input: PayrollRowInputValue,
  facts: LedgerFacts & LedgerCalculationFacts,
  context: LedgerDecisionContext,
): Result.Result<LedgerDecision & { row: PayrollRowRecord }, RowWriteRejection> {
  const rejected = editRejection(ledger, facts, context)
  if (rejected !== undefined) return Result.fail(rejected)
  const row = ledger.rows.find((candidate) => candidate.id === rowId)
  if (row === undefined) return Result.fail(new PayrollRowNotFound({}))
  if (input.incomeType !== row.input.incomeType) {
    return Result.fail(new PayrollRowPayeeInvalid({ reason: 'INCOME_TYPE_CHANGED' }))
  }
  const violations = rowItemViolations(input, row.input, facts.catalog)
  if (violations.length > 0) return Result.fail(new PayrollRowItemInvalid({ violations }))
  const updated: PayrollRowRecord = { ...row, input, updatedAt: context.at }
  const next = {
    ...ledger,
    rows: ledger.rows.map((candidate) => (candidate.id === rowId ? updated : candidate)),
    version: ledger.version + 1,
    updatedAt: context.at,
  }
  return Result.map(calculateLedger(next, facts, context.at), (calculated) => ({
    ...decided(facts.ledgers, calculated, context.at),
    row: calculated.rows.find((candidate) => candidate.id === rowId) ?? updated,
  }))
}

/** 행 지우기를 판정합니다. 남은 행은 다시 계산하지 않습니다. */
export function decideRowDeletion(
  ledger: PayrollLedgerRecord,
  rowId: Id<'payrollRow'>,
  facts: LedgerFacts,
  context: LedgerDecisionContext,
): Result.Result<LedgerDecision, LedgerEditRejection | PayrollRowNotFound> {
  const rejected = editRejection(ledger, facts, context)
  if (rejected !== undefined) return Result.fail(rejected)
  if (!ledger.rows.some((row) => row.id === rowId)) return Result.fail(new PayrollRowNotFound({}))
  const next = {
    ...ledger,
    rows: ledger.rows.filter((row) => row.id !== rowId),
    version: ledger.version + 1,
    updatedAt: context.at,
  }
  return Result.succeed(decided(facts.ledgers, next, context.at))
}

/** 다시 계산이 받는 행 소득자의 지금 정보입니다. 서비스가 행마다 HR 직원(임금산정 기간 말일 기준)과 명부 소득자를 읽어 둡니다. */
export interface RefreshedPayees {
  employees: ReadonlyMap<Id<'employee'>, PayrollEmployee>
  earners: ReadonlyMap<Id<'earner'>, EarnerRecord>
}

/**
 * 다시 계산을 판정합니다. 행의 사본(계산 입력·이름·소득자)을 지금의 HR 정보와 소득자 명부로 갱신하고 모든 행을 다시 계산합니다.
 * 직원이나 소득자가 없어졌으면 그 행의 사본은 그대로 둡니다.
 */
export function decideLedgerRecalculation(
  ledger: PayrollLedgerRecord,
  facts: LedgerFacts & LedgerCalculationFacts & RefreshedPayees,
  context: LedgerDecisionContext,
): Result.Result<LedgerDecision, LedgerEditRejection | RateTableNotFound> {
  const rejected = editRejection(ledger, facts, context)
  if (rejected !== undefined) return Result.fail(rejected)
  const rows = ledger.rows.map((row): PayrollRowRecord => {
    if (row.employeeId === null) {
      const earner = row.earnerId === null ? undefined : facts.earners.get(row.earnerId)
      return earner === undefined ? row : { ...row, payeeName: earner.name, earner: earnerFromRegistry(earner) }
    }
    const employee = facts.employees.get(row.employeeId)
    return employee === undefined
      ? row
      : { ...row, snapshot: snapshotOf(employee), payeeName: employee.name, earner: earnerOf(employee) }
  })
  const next = { ...ledger, rows, version: ledger.version + 1, updatedAt: context.at }
  return Result.map(calculateLedger(next, facts, context.at), (calculated) =>
    decided(facts.ledgers, calculated, context.at),
  )
}

/**
 * 상태 커맨드를 판정합니다. 전이표({@link decideTransition})가 허락해야 하고, 입력을 마치는 전이(`DRAFT`에서 나가는 제출·직접
 * 마감)는 모든 행을 다시 계산합니다. 지급월의 대장이 모두 마감되거나 마감이 풀리면 이벤트를 냅니다.
 */
export function decideLedgerTransition(
  ledger: PayrollLedgerRecord,
  transition: LedgerTransition,
  reason: string | undefined,
  facts: LedgerFacts & LedgerCalculationFacts,
  context: LedgerDecisionContext,
): Result.Result<LedgerDecision, PayrollLedgerTransitionInvalid | WithholdingFiled | RateTableNotFound> {
  const paymentMonth = paymentMonthOf(ledger.paymentDate)
  const decision = decideTransition(transition, {
    status: ledger.status,
    workflow: ledger.workflow,
    actor: context.actor.kind,
    withholdingFiled: facts.filedPaymentMonths.has(paymentMonth),
  })
  if (!decision.ok) {
    return Result.fail(
      decision.reason === 'WITHHOLDING_FILED'
        ? new WithholdingFiled({ paymentMonth })
        : new PayrollLedgerTransitionInvalid({ ledgerStatus: ledger.status, action: transition }),
    )
  }
  const at = context.at
  const moved: PayrollLedgerRecord = { ...ledger, status: decision.to, version: ledger.version + 1, updatedAt: at }
  const calculated = ledger.status === 'DRAFT' ? calculateLedger(moved, facts, at) : Result.succeed(moved)
  return Result.map(calculated, (result) => {
    let next = result
    if (transition === 'REJECT') next = { ...next, rejection: { reason: reason ?? '', rejectedAt: at } }
    if (transition === 'REQUEST_APPROVAL') next = { ...next, rejection: null }
    if (decision.to === 'CLOSED') next = { ...next, closedAt: at }
    if (transition === 'REOPEN') next = { ...next, closedAt: null, reopenReason: reason ?? '' }
    return decided(facts.ledgers, next, at)
  })
}

/** 대장의 모든 행을 귀속월·지급월 기준표와 회사 설정으로 계산합니다. 그 달의 기준표가 없으면 `RATE_TABLE_NOT_FOUND`입니다. */
export function calculateLedger(
  ledger: PayrollLedgerRecord,
  facts: LedgerCalculationFacts,
  at: string,
): Result.Result<PayrollLedgerRecord, RateTableNotFound> {
  const attributionRates = rateTableOf(facts.rateTables, ledger.attributionMonth)
  if (attributionRates === undefined) return Result.fail(new RateTableNotFound({ month: ledger.attributionMonth }))
  const paymentMonth = paymentMonthOf(ledger.paymentDate)
  const paymentRates = rateTableOf(facts.rateTables, paymentMonth)
  if (paymentRates === undefined) return Result.fail(new RateTableNotFound({ month: paymentMonth }))
  const context = {
    attributionMonth: ledger.attributionMonth,
    attributionRates,
    paymentRates,
    setting: facts.setting,
    catalog: facts.catalog,
  }
  return Result.succeed({
    ...ledger,
    calculatedAt: at,
    rows: ledger.rows.map((row) => ({ ...row, result: calculateRow(row.input, row.snapshot, context) })),
  })
}

/** HR 직원 정보를 행 스냅숏으로 바꿉니다. */
export function snapshotOf(employee: PayrollEmployee): EmployeeSnapshot {
  const ratio = employee.incomeTax.withholdingRatePpm
  return {
    dependants: Math.max(1, employee.incomeTax.dependants),
    childrenAged8To20: employee.incomeTax.childrenAged8To20,
    ...(employee.incomeTax.childcareChildren === null
      ? {}
      : {
          childcareChildren: employee.incomeTax.childcareChildren.count,
          childcareChildrenEffectiveFrom: employee.incomeTax.childcareChildren.effectiveFrom,
        }),
    withholdingRatePpm: ratio === 800_000 || ratio === 1_200_000 ? ratio : 1_000_000,
    manualIncomeTax: employee.incomeTax.manualAmount,
    socialInsurance: { ...employee.socialInsurance },
    monthlyStandardHours: employee.monthlyStandardHours,
    dailyRestMinutes: employee.dailyRestMinutes,
  }
}

/**
 * 정기 대장의 근로 행 초기 입력입니다. 월급제가 임금산정 기간 중에 입사·퇴사했으면 역일 기준 일할계산을 넣습니다.
 * 회사 카탈로그의 기본 금액이 있는 지급 항목과 `FIXED` 공제 항목을 미리 넣습니다({@link defaultRowItems}).
 */
export function initialWageInput(
  employee: PayrollEmployee,
  period: { start: string; end: string },
  catalog: PayrollItemCatalog,
): PayrollRowInputValue {
  const { paymentItems, otherDeductions } = defaultRowItems(catalog)
  const items = {
    ...(paymentItems.length === 0 ? {} : { paymentItems }),
    ...(otherDeductions.length === 0 ? {} : { otherDeductions }),
  }
  if (employee.paymentUnit === 'HOURLY') return { incomeType: 'WAGE_HOURLY', hourlyWage: employee.hourlyWage, ...items }
  if (employee.paymentUnit === 'DAILY')
    return { incomeType: 'WAGE_DAILY', dailyWage: employee.dailyWage, workedDays: 0, ...items }
  const 시작일 = employee.joinDate > period.start ? employee.joinDate : period.start
  const 종료일 = employee.leaveDate !== null && employee.leaveDate < period.end ? employee.leaveDate : period.end
  const 기간일수 = daysBetween(period.start, period.end) + 1
  const 지급일수 = Math.max(0, daysBetween(시작일, 종료일) + 1)
  return {
    incomeType: 'WAGE_MONTHLY',
    basePay: employee.basePay,
    ...(지급일수 < 기간일수
      ? { proration: { method: 'CALENDAR_DAYS' as const, payableDays: 지급일수, totalDays: 기간일수 } }
      : {}),
    ...items,
  }
}

/** 입력을 고치는 커맨드의 공통 거부입니다. 행위자가 그 상태의 입력을 고칠 수 없거나, 대장의 지급월이 신고됐습니다. */
function editRejection(
  ledger: PayrollLedgerRecord,
  facts: LedgerFacts,
  context: LedgerDecisionContext,
): LedgerEditRejection | undefined {
  if (!canEditInput(ledger.status, context.actor.kind)) {
    return new PayrollLedgerReadOnly({ ledgerStatus: ledger.status })
  }
  return firstFiled(facts, [paymentMonthOf(ledger.paymentDate)])
}

/** 지급월 중 원천세가 신고된 첫 달의 거부입니다. */
function firstFiled(facts: LedgerFacts, paymentMonths: readonly string[]): WithholdingFiled | undefined {
  const paymentMonth = paymentMonths.find((month) => facts.filedPaymentMonths.has(month))
  return paymentMonth === undefined ? undefined : new WithholdingFiled({ paymentMonth })
}

/** 새 행의 소득자입니다. 거부 순서는 둘 다 가리킴 → 추가 대장의 근로 행 → 직원 없는 근로 행 → 명부 소득자 → 직원 → 근로소득 중복입니다. */
function payeeOf(
  ledger: PayrollLedgerRecord,
  input: RowAddition,
  facts: LedgerFacts & PayeeFacts,
): Result.Result<
  Pick<PayrollRowRecord, 'employeeId' | 'earnerId' | 'payeeName' | 'earner' | 'snapshot'>,
  WageRowOnAdditionalLedger | PayrollRowPayeeInvalid | EmployeeNotFound | WageIncomeDuplicated
> {
  if (input.employeeId !== undefined && input.earnerId !== undefined) {
    return Result.fail(new PayrollRowPayeeInvalid({ reason: 'PAYEE_AMBIGUOUS' }))
  }
  const 근로행 = isWage(input.input)
  if (근로행 && ledger.kind === 'ADDITIONAL') return Result.fail(new WageRowOnAdditionalLedger({}))
  if (근로행 && input.employeeId === undefined) {
    return Result.fail(new PayrollRowPayeeInvalid({ reason: 'EMPLOYEE_REQUIRED' }))
  }
  if (input.earnerId !== undefined) {
    if (facts.earner === undefined) return Result.fail(new PayrollRowPayeeInvalid({ reason: 'EARNER_NOT_FOUND' }))
    return Result.succeed({
      employeeId: null,
      earnerId: input.earnerId,
      payeeName: facts.earner.name,
      earner: earnerFromRegistry(facts.earner),
      snapshot: null,
    })
  }
  if (input.employeeId === undefined) return Result.fail(new PayrollRowPayeeInvalid({ reason: 'PAYEE_REQUIRED' }))
  if (facts.employee === undefined) return Result.fail(new EmployeeNotFound({}))
  if (근로행) {
    const 근로행목록 = facts.ledgers.flatMap((other) =>
      other.rows
        .filter((row) => row.employeeId !== null && isWage(row.input))
        .map((row) => ({
          ledgerId: other.id,
          attributionMonth: other.attributionMonth,
          employeeId: row.employeeId ?? '',
        })),
    )
    const duplicated = duplicatedWageIncome(근로행목록, {
      attributionMonth: ledger.attributionMonth,
      employeeId: input.employeeId,
    })
    if (duplicated !== null) return Result.fail(new WageIncomeDuplicated({ ledgerId: duplicated }))
  }
  return Result.succeed({
    employeeId: input.employeeId,
    earnerId: null,
    payeeName: facts.employee.name,
    earner: earnerOf(facts.employee),
    snapshot: 근로행 ? snapshotOf(facts.employee) : null,
  })
}

/** 바뀐 대장과 그 변경이 낸 지급월 이벤트입니다. */
function decided(before: ReadonlyArray<PayrollLedgerRecord>, ledger: PayrollLedgerRecord, at: string): LedgerDecision {
  const after = before.some((other) => other.id === ledger.id)
    ? before.map((other) => (other.id === ledger.id ? ledger : other))
    : [...before, ledger]
  return { ledger, events: payMonthEvents(ledger.companyId, before, after, at) }
}

/** 지급월의 대장이 모두 마감되거나 마감이 풀린 달마다 이벤트를 만듭니다. */
function payMonthEvents(
  companyId: Id<'company'>,
  before: ReadonlyArray<PayrollLedgerRecord>,
  after: ReadonlyArray<PayrollLedgerRecord>,
  at: string,
): PayrollEvent[] {
  return payMonthChanges(before, after).map((change): PayrollEvent => {
    if (change.kind === 'REOPENED') {
      return {
        type: 'payroll_pay_month.reopened',
        eventId: newId('event'),
        companyId,
        paymentMonth: change.paymentMonth,
        occurredAt: at,
      }
    }
    return {
      type: 'payroll_pay_month.closed',
      eventId: newId('event'),
      companyId,
      paymentMonth: change.paymentMonth,
      ledgerIds: after
        .filter((ledger) => paymentMonthOf(ledger.paymentDate) === change.paymentMonth)
        // 저장소 목록과 같은 순서(귀속월, ID)입니다.
        .toSorted((a, b) => a.attributionMonth.localeCompare(b.attributionMonth) || a.id.localeCompare(b.id))
        .map((ledger) => ledger.id),
      occurredAt: at,
    }
  })
}

function rateTableOf(tables: ReadonlyArray<PayrollRateTable>, month: string): PayrollRateTable | undefined {
  try {
    return resolveRateTable(tables, month as Parameters<typeof resolveRateTable>[1])
  } catch {
    return undefined
  }
}

function isWage(input: PayrollRowInputValue): boolean {
  return input.incomeType === 'WAGE_MONTHLY' || input.incomeType === 'WAGE_HOURLY' || input.incomeType === 'WAGE_DAILY'
}

/** HR 직원 정보를 소득자 사본으로 바꿉니다. HR은 주민번호가 없는 직원의 가린 값을 빈 문자열로 주므로 `null`로 둡니다. */
function earnerOf(employee: PayrollEmployee): PayrollEarner {
  return {
    email: employee.email,
    registrationNumberMasked: employee.registrationNumberMasked === '' ? null : employee.registrationNumberMasked,
    departmentName: employee.departmentName,
  }
}

/** 소득자 명부의 소득자를 소득자 사본으로 바꿉니다. 신원번호는 명부가 가려 둔 값입니다. */
function earnerFromRegistry(earner: EarnerRecord): PayrollEarner {
  return {
    email: earner.email,
    registrationNumberMasked: earner.registrationNumberMasked,
    departmentName: earner.departmentName,
  }
}
