import { Clock, Effect, Option } from 'effect'
import { paginate, type PageOf, type PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { daysBetween } from '../../../shared/time/calendar.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import type { Actor, Permission } from '../../identity-access/actor.types.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { LEDGER_PLANS } from '../payroll-access.ts'
import {
  AdditionalLedgerBlocked,
  EmployeeNotFound,
  PayrollLedgerHasAdditional,
  PayrollLedgerNotFound,
  PayrollLedgerReadOnly,
  PayrollLedgerTransitionInvalid,
  PayrollRowNotFound,
  PayrollRowPayeeInvalid,
  RateTableNotFound,
  WageIncomeDuplicated,
  WageRowOnAdditionalLedger,
  WithholdingFiled,
} from '../payroll-problems.ts'
import { PayrollEmployeeDirectory, type PayrollEmployee } from '../ports/payroll-employee-directory.ts'
import { PayrollEventPublisher } from '../ports/payroll-events.ts'
import { WithholdingFilingLock } from '../ports/withholding-filing-lock.ts'
import type { RateTableRepository } from '../rate-tables/rate-table-repository.ts'
import { resolveOrFail } from '../rate-tables/rate-tables.ts'
import type { EmployeeSnapshot, PayrollRowInputValue } from '../rows/payroll-row-input.ts'
import { calculateRow } from '../rows/row-calculation.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'
import {
  additionalLedgerBlocker,
  defaultPaymentDate,
  duplicatedWageIncome,
  paymentMonthOf,
  wagePeriodOf,
} from './ledger-rules.ts'
import { canEditInput, decideTransition } from './ledger-status.ts'
import type { LedgerStatus, LedgerTransition } from './ledger-status.types.ts'
import { payMonthChanges, withholdingSummary } from './pay-month.ts'
import type {
  AddPayrollRow,
  CreatePayrollLedger,
  PayrollLedger,
  PayrollRow,
  UpdatePayrollLedger,
  UpdatePayrollRow,
} from './payroll-ledger.ts'
import { ledgerResponse, rowResponse } from './payroll-ledger.ts'
import { PayrollLedgerRepository } from './payroll-ledger-repository.ts'
import type { PayrollLedgerRecord, PayrollRowRecord } from './payroll-ledger.types.ts'

/** 급여대장 유스케이스가 쓰는 저장소와 포트입니다. */
export type LedgerDeps =
  | PayrollLedgerRepository
  | PayrollSettingRepository
  | RateTableRepository
  | PayrollEmployeeDirectory
  | WithholdingFilingLock
  | PayrollEventPublisher

/** 급여대장 쓰기 유스케이스가 낼 수 있는 업무 오류입니다. */
export type LedgerError =
  | AccessDenied
  | VersionMismatch
  | PayrollLedgerNotFound
  | PayrollRowNotFound
  | PayrollLedgerTransitionInvalid
  | PayrollLedgerReadOnly
  | WithholdingFiled
  | AdditionalLedgerBlocked
  | WageRowOnAdditionalLedger
  | WageIncomeDuplicated
  | PayrollLedgerHasAdditional
  | PayrollRowPayeeInvalid
  | EmployeeNotFound
  | RateTableNotFound

type LedgerResponse = typeof PayrollLedger.Type
type RowResponse = typeof PayrollRow.Type
type Run<A, E = LedgerError> = Effect.Effect<A, E, CurrentActor | LedgerDeps>

/** 상태 커맨드별 권한입니다. 승인·반려는 고객의 결재 권한이라 따로 둡니다. */
export const TRANSITION_PERMISSIONS: Record<LedgerTransition, Permission> = {
  SUBMIT: 'payroll-ledger:submit',
  RETURN_TO_DRAFT: 'payroll-ledger:submit',
  REQUEST_APPROVAL: 'payroll-ledger:submit',
  WITHDRAW_APPROVAL_REQUEST: 'payroll-ledger:submit',
  APPROVE: 'payroll-ledger:approve',
  REJECT: 'payroll-ledger:approve',
  CLOSE: 'payroll-ledger:close',
  REOPEN: 'payroll-ledger:close',
}

/** 급여대장 목록입니다. 귀속월 순입니다. */
export const listLedgers = (
  query: PageQuery & { attributionMonth?: string; paymentMonth?: string; status?: LedgerStatus },
): Run<PageOf<LedgerResponse>, AccessDenied> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:read', plans: LEDGER_PLANS, requiresTerms: true })
    const ledgers = (yield* (yield* PayrollLedgerRepository).list(actor.companyId)).filter(
      (ledger) =>
        (query.attributionMonth === undefined || ledger.attributionMonth === query.attributionMonth) &&
        (query.paymentMonth === undefined || paymentMonthOf(ledger.paymentDate) === query.paymentMonth) &&
        (query.status === undefined || ledger.status === query.status),
    )
    const page = paginate(ledgers, (ledger) => `${ledger.attributionMonth}|${ledger.id}`, query)
    const items: LedgerResponse[] = []
    for (const ledger of page.items) items.push(yield* respond(actor, ledger))
    return { ...page, items }
  })

/** 급여대장 하나입니다. */
export const getLedger = (id: Id<'payrollLedger'>): Run<LedgerResponse, AccessDenied | PayrollLedgerNotFound> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:read', plans: LEDGER_PLANS, requiresTerms: true })
    return yield* respond(actor, yield* findOrFail(actor.companyId, id))
  })

/** 대장의 행 목록입니다. */
export const listRows = (
  id: Id<'payrollLedger'>,
): Run<{ items: RowResponse[] }, AccessDenied | PayrollLedgerNotFound> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:read', plans: LEDGER_PLANS, requiresTerms: true })
    const ledger = yield* findOrFail(actor.companyId, id)
    return { items: ledger.rows.map((row) => rowResponse(ledger, row)) }
  })

/**
 * 급여대장을 만듭니다. 귀속월의 첫 대장은 정기 대장이고 임금산정 기간에 재직한 근로소득자로 행을 채웁니다.
 * 그 뒤 대장은 추가 대장이고 추가 대장 규칙을 통과해야 합니다.
 */
export const createLedger = (payload: typeof CreatePayrollLedger.Type): Run<LedgerResponse> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:create', plans: LEDGER_PLANS, requiresTerms: true })
    const repository = yield* PayrollLedgerRepository
    const setting = yield* (yield* PayrollSettingRepository).get(actor.companyId)
    const before = yield* repository.list(actor.companyId)
    const sameMonth = before.filter((ledger) => ledger.attributionMonth === payload.attributionMonth)
    const regular = sameMonth.find((ledger) => ledger.kind === 'REGULAR')
    const kind = sameMonth.length === 0 ? 'REGULAR' : 'ADDITIONAL'
    const paymentDate =
      payload.paymentDate ?? regular?.paymentDate ?? defaultPaymentDate(payload.attributionMonth, setting)
    const paymentMonth = paymentMonthOf(paymentDate)
    const filed = yield* (yield* WithholdingFilingLock).isFiled(actor.companyId, paymentMonth)
    const now = yield* nowIso
    if (kind === 'ADDITIONAL') {
      const blocker = additionalLedgerBlocker({
        attributionMonth: payload.attributionMonth,
        paymentDate,
        today: companyDate(Date.parse(now)),
        ledgers: before,
        withholdingFiled: filed,
      })
      if (blocker === 'WITHHOLDING_FILED') return yield* new WithholdingFiled({ paymentMonth })
      if (blocker !== null) return yield* new AdditionalLedgerBlocked({ reason: blocker })
    } else if (filed) {
      return yield* new WithholdingFiled({ paymentMonth })
    }
    const wagePeriod = wagePeriodOf(payload.attributionMonth, setting.wagePeriodStartDay)
    const employees =
      kind === 'REGULAR' ? yield* (yield* PayrollEmployeeDirectory).listWageEarners(actor.companyId, wagePeriod) : []
    const [year, month] = payload.attributionMonth.split('-')
    const draft: PayrollLedgerRecord = {
      id: newId('payrollLedger'),
      companyId: actor.companyId,
      kind,
      workflow: setting.workflow,
      status: 'DRAFT',
      title: payload.title ?? `${year}년 ${Number(month)}월 ${kind === 'REGULAR' ? '급여' : '추가 급여'}`,
      attributionMonth: payload.attributionMonth,
      paymentDate,
      wagePeriod,
      rows: employees.map((employee) => ({
        id: newId('payrollRow'),
        employeeId: employee.id,
        payeeName: employee.name,
        input: initialWageInput(employee, wagePeriod),
        snapshot: snapshotOf(employee),
        result: null,
        updatedAt: now,
      })),
      rejection: null,
      reopenReason: null,
      calculatedAt: null,
      closedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    const ledger = yield* calculateAll(draft, now)
    yield* saveWithEvents(actor.companyId, before, ledger)
    return yield* respond(actor, ledger)
  })

/** 대장 머리(제목·지급일)를 고칩니다. 지급일을 신고가 끝난 달로 옮기거나 그런 달에서 빼낼 수 없습니다. */
export const updateLedger = (
  id: Id<'payrollLedger'>,
  patch: typeof UpdatePayrollLedger.Type,
  expected: number | undefined,
): Run<LedgerResponse> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, before } = yield* editable(actor, id, expected)
    const now = yield* nowIso
    let next: PayrollLedgerRecord = { ...ledger, ...patch, version: ledger.version + 1, updatedAt: now }
    if (patch.paymentDate !== undefined && paymentMonthOf(patch.paymentDate) !== paymentMonthOf(ledger.paymentDate)) {
      const target = paymentMonthOf(patch.paymentDate)
      if (yield* (yield* WithholdingFilingLock).isFiled(actor.companyId, target)) {
        return yield* new WithholdingFiled({ paymentMonth: target })
      }
      next = yield* calculateAll(next, now)
    }
    yield* saveWithEvents(actor.companyId, before, next)
    return yield* respond(actor, next)
  })

/** 입력 중인 대장을 지웁니다. 추가 대장이 딸린 정기 대장은 추가 대장을 먼저 지워야 합니다. */
export const deleteLedger = (id: Id<'payrollLedger'>, expected: number | undefined): Run<void> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:delete', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, before } = yield* editable(actor, id, expected)
    if (ledger.status !== 'DRAFT') {
      return yield* new PayrollLedgerTransitionInvalid({ ledgerStatus: ledger.status, action: 'DELETE' })
    }
    if (
      ledger.kind === 'REGULAR' &&
      before.some((other) => other.id !== ledger.id && other.attributionMonth === ledger.attributionMonth)
    ) {
      return yield* new PayrollLedgerHasAdditional({})
    }
    const repository = yield* PayrollLedgerRepository
    yield* repository.remove(actor.companyId, id)
    yield* publishChanges(actor.companyId, before, yield* repository.list(actor.companyId))
  })

/** 행을 추가하고 바로 계산합니다. */
export const addRow = (
  id: Id<'payrollLedger'>,
  payload: typeof AddPayrollRow.Type,
  expected: number | undefined,
): Run<{ ledger: PayrollLedgerRecord; row: RowResponse }> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, before } = yield* editable(actor, id, expected)
    const now = yield* nowIso
    const payee = yield* payeeOf(actor, ledger, before, payload)
    const row: PayrollRowRecord = {
      id: newId('payrollRow'),
      employeeId: payee.employeeId,
      payeeName: payee.payeeName,
      input: payload.input,
      snapshot: payee.snapshot,
      result: null,
      updatedAt: now,
    }
    const next = yield* calculateAll(
      { ...ledger, rows: [...ledger.rows, row], version: ledger.version + 1, updatedAt: now },
      now,
    )
    yield* saveWithEvents(actor.companyId, before, next)
    return { ledger: next, row: rowResponse(next, next.rows.at(-1) ?? row) }
  })

/** 행 입력을 고치고 다시 계산합니다. 소득 구분은 바꿀 수 없습니다. */
export const updateRow = (
  id: Id<'payrollLedger'>,
  rowId: Id<'payrollRow'>,
  patch: typeof UpdatePayrollRow.Type,
  expected: number | undefined,
): Run<{ ledger: PayrollLedgerRecord; row: RowResponse }> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, before } = yield* editable(actor, id, expected)
    const row = ledger.rows.find((candidate) => candidate.id === rowId)
    if (row === undefined) return yield* new PayrollRowNotFound({})
    if (patch.input !== undefined && patch.input.incomeType !== row.input.incomeType) {
      return yield* new PayrollRowPayeeInvalid({ reason: 'INCOME_TYPE_CHANGED' })
    }
    const now = yield* nowIso
    const updated: PayrollRowRecord = {
      ...row,
      input: patch.input ?? row.input,
      payeeName: row.employeeId === null ? (patch.payeeName ?? row.payeeName) : row.payeeName,
      updatedAt: now,
    }
    const next = yield* calculateAll(
      {
        ...ledger,
        rows: ledger.rows.map((candidate) => (candidate.id === rowId ? updated : candidate)),
        version: ledger.version + 1,
        updatedAt: now,
      },
      now,
    )
    yield* saveWithEvents(actor.companyId, before, next)
    return { ledger: next, row: rowResponse(next, next.rows.find((candidate) => candidate.id === rowId) ?? updated) }
  })

/** 행을 지웁니다. */
export const deleteRow = (id: Id<'payrollLedger'>, rowId: Id<'payrollRow'>, expected: number | undefined): Run<void> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, before } = yield* editable(actor, id, expected)
    if (!ledger.rows.some((row) => row.id === rowId)) return yield* new PayrollRowNotFound({})
    const now = yield* nowIso
    yield* saveWithEvents(actor.companyId, before, {
      ...ledger,
      rows: ledger.rows.filter((row) => row.id !== rowId),
      version: ledger.version + 1,
      updatedAt: now,
    })
  })

/** HR 정보를 다시 받아 모든 행을 다시 계산합니다. 기준표·설정이 바뀐 뒤에 씁니다. */
export const recalculateLedger = (id: Id<'payrollLedger'>, expected: number | undefined): Run<LedgerResponse> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, before } = yield* editable(actor, id, expected)
    const directory = yield* PayrollEmployeeDirectory
    const now = yield* nowIso
    const rows: PayrollRowRecord[] = []
    for (const row of ledger.rows) {
      if (row.employeeId === null) {
        rows.push(row)
        continue
      }
      const found = yield* directory.find(actor.companyId, row.employeeId, ledger.wagePeriod.end)
      rows.push(Option.isSome(found) ? { ...row, snapshot: snapshotOf(found.value), payeeName: found.value.name } : row)
    }
    const next = yield* calculateAll({ ...ledger, rows, version: ledger.version + 1, updatedAt: now }, now)
    yield* saveWithEvents(actor.companyId, before, next)
    return yield* respond(actor, next)
  })

/**
 * 상태 커맨드를 실행합니다. 전이표({@link decideTransition})가 허락해야 하고, 입력을 마치는 전이(제출·직접 마감)는
 * 모든 행을 다시 계산합니다. 지급월의 대장이 모두 마감되거나 마감이 풀리면 이벤트를 냅니다.
 */
export const transitionLedger = (
  id: Id<'payrollLedger'>,
  transition: LedgerTransition,
  reason: string | undefined,
  expected: number | undefined,
): Run<LedgerResponse> =>
  Effect.gen(function* () {
    const actor = yield* authorize({
      permission: TRANSITION_PERMISSIONS[transition],
      plans: LEDGER_PLANS,
      requiresTerms: true,
    })
    const repository = yield* PayrollLedgerRepository
    const before = yield* repository.list(actor.companyId)
    const ledger = before.find((candidate) => candidate.id === id)
    if (ledger === undefined) return yield* new PayrollLedgerNotFound({})
    yield* checkVersion(ledger.version, expected)
    const paymentMonth = paymentMonthOf(ledger.paymentDate)
    const filed = yield* (yield* WithholdingFilingLock).isFiled(actor.companyId, paymentMonth)
    const decision = decideTransition(transition, {
      status: ledger.status,
      workflow: ledger.workflow,
      actor: actor.kind,
      withholdingFiled: filed,
    })
    if (!decision.ok) {
      return yield* decision.reason === 'WITHHOLDING_FILED'
        ? new WithholdingFiled({ paymentMonth })
        : new PayrollLedgerTransitionInvalid({ ledgerStatus: ledger.status, action: transition })
    }
    const now = yield* nowIso
    let next: PayrollLedgerRecord = { ...ledger, status: decision.to, version: ledger.version + 1, updatedAt: now }
    if (ledger.status === 'DRAFT') next = yield* calculateAll(next, now)
    if (transition === 'REJECT') next = { ...next, rejection: { reason: reason ?? '', rejectedAt: now } }
    if (transition === 'REQUEST_APPROVAL') next = { ...next, rejection: null }
    if (decision.to === 'CLOSED') next = { ...next, closedAt: now }
    if (transition === 'REOPEN') next = { ...next, closedAt: null, reopenReason: reason ?? '' }
    yield* saveWithEvents(actor.companyId, before, next)
    return yield* respond(actor, next)
  })

const nowIso = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString())

function findOrFail(
  companyId: Id<'company'>,
  id: Id<'payrollLedger'>,
): Effect.Effect<PayrollLedgerRecord, PayrollLedgerNotFound, PayrollLedgerRepository> {
  return Effect.gen(function* () {
    const found = yield* (yield* PayrollLedgerRepository).find(companyId, id)
    if (Option.isNone(found)) return yield* new PayrollLedgerNotFound({})
    return found.value
  })
}

function respond(
  actor: Actor,
  ledger: PayrollLedgerRecord,
): Effect.Effect<LedgerResponse, never, WithholdingFilingLock> {
  return Effect.gen(function* () {
    const filed = yield* (yield* WithholdingFilingLock).isFiled(ledger.companyId, paymentMonthOf(ledger.paymentDate))
    return ledgerResponse(ledger, actor.kind, filed)
  })
}

/** 행위자가 지금 입력을 고칠 수 있는 대장을 읽습니다. 버전·상태·신고 잠금을 차례로 봅니다. */
function editable(
  actor: Actor,
  id: Id<'payrollLedger'>,
  expected: number | undefined,
): Effect.Effect<
  { ledger: PayrollLedgerRecord; before: ReadonlyArray<PayrollLedgerRecord> },
  PayrollLedgerNotFound | VersionMismatch | PayrollLedgerReadOnly | WithholdingFiled,
  PayrollLedgerRepository | WithholdingFilingLock
> {
  return Effect.gen(function* () {
    const before = yield* (yield* PayrollLedgerRepository).list(actor.companyId)
    const ledger = before.find((candidate) => candidate.id === id)
    if (ledger === undefined) return yield* new PayrollLedgerNotFound({})
    yield* checkVersion(ledger.version, expected)
    if (!canEditInput(ledger.status, actor.kind))
      return yield* new PayrollLedgerReadOnly({ ledgerStatus: ledger.status })
    const paymentMonth = paymentMonthOf(ledger.paymentDate)
    if (yield* (yield* WithholdingFilingLock).isFiled(actor.companyId, paymentMonth)) {
      return yield* new WithholdingFiled({ paymentMonth })
    }
    return { ledger, before }
  })
}

/** 새 행의 소득자를 정합니다. 근로 행은 정기 대장에만, 직원·귀속월마다 하나만 넣을 수 있습니다. */
function payeeOf(
  actor: Actor,
  ledger: PayrollLedgerRecord,
  ledgers: ReadonlyArray<PayrollLedgerRecord>,
  payload: typeof AddPayrollRow.Type,
): Effect.Effect<
  { employeeId: Id<'employee'> | null; payeeName: string; snapshot: EmployeeSnapshot | null },
  WageRowOnAdditionalLedger | PayrollRowPayeeInvalid | EmployeeNotFound | WageIncomeDuplicated,
  PayrollEmployeeDirectory
> {
  return Effect.gen(function* () {
    if (!isWage(payload.input)) {
      if (payload.payeeName !== undefined) {
        // 이름을 직접 받아도 직원을 이으려면 같은 회사 직원이어야 합니다. 다른 회사 직원 ID를 저장하지 않습니다.
        if (payload.employeeId !== undefined) {
          const linked = yield* (yield* PayrollEmployeeDirectory).find(
            actor.companyId,
            payload.employeeId,
            ledger.wagePeriod.end,
          )
          if (Option.isNone(linked)) return yield* new EmployeeNotFound({})
        }
        return { employeeId: payload.employeeId ?? null, payeeName: payload.payeeName, snapshot: null }
      }
      if (payload.employeeId === undefined) return yield* new PayrollRowPayeeInvalid({ reason: 'PAYEE_NAME_REQUIRED' })
    }
    if (isWage(payload.input) && ledger.kind === 'ADDITIONAL') return yield* new WageRowOnAdditionalLedger({})
    if (payload.employeeId === undefined) return yield* new PayrollRowPayeeInvalid({ reason: 'EMPLOYEE_REQUIRED' })
    const found = yield* (yield* PayrollEmployeeDirectory).find(
      actor.companyId,
      payload.employeeId,
      ledger.wagePeriod.end,
    )
    if (Option.isNone(found)) return yield* new EmployeeNotFound({})
    if (isWage(payload.input)) {
      const existing = ledgers.flatMap((other) =>
        other.rows
          .filter((row) => row.employeeId !== null && isWage(row.input))
          .map((row) => ({
            ledgerId: other.id,
            attributionMonth: other.attributionMonth,
            employeeId: row.employeeId ?? '',
          })),
      )
      const duplicated = duplicatedWageIncome(existing, {
        attributionMonth: ledger.attributionMonth,
        employeeId: payload.employeeId,
      })
      if (duplicated !== null) return yield* new WageIncomeDuplicated({ ledgerId: duplicated })
    }
    return {
      employeeId: payload.employeeId,
      payeeName: payload.payeeName ?? found.value.name,
      snapshot: isWage(payload.input) ? snapshotOf(found.value) : null,
    }
  })
}

/** 대장의 모든 행을 귀속월·지급월 기준표와 회사 설정으로 계산합니다. */
function calculateAll(
  ledger: PayrollLedgerRecord,
  now: string,
): Effect.Effect<PayrollLedgerRecord, RateTableNotFound, RateTableRepository | PayrollSettingRepository> {
  return Effect.gen(function* () {
    const attributionRates = yield* resolveOrFail(ledger.attributionMonth)
    const paymentRates = yield* resolveOrFail(paymentMonthOf(ledger.paymentDate))
    const setting = yield* (yield* PayrollSettingRepository).get(ledger.companyId)
    const context = {
      attributionMonth: ledger.attributionMonth,
      attributionRates: attributionRates.table,
      paymentRates: paymentRates.table,
      setting,
    }
    return {
      ...ledger,
      calculatedAt: now,
      rows: ledger.rows.map((row) => ({ ...row, result: calculateRow(row.input, row.snapshot, context) })),
    }
  })
}

/** 대장을 저장하고, 지급월 마감 상태가 바뀌었으면 이벤트를 냅니다. */
function saveWithEvents(
  companyId: Id<'company'>,
  before: ReadonlyArray<PayrollLedgerRecord>,
  ledger: PayrollLedgerRecord,
): Effect.Effect<void, never, PayrollLedgerRepository | PayrollEventPublisher> {
  return Effect.gen(function* () {
    const repository = yield* PayrollLedgerRepository
    yield* repository.save(ledger)
    yield* publishChanges(companyId, before, yield* repository.list(companyId))
  })
}

function publishChanges(
  companyId: Id<'company'>,
  before: ReadonlyArray<PayrollLedgerRecord>,
  after: ReadonlyArray<PayrollLedgerRecord>,
): Effect.Effect<void, never, PayrollEventPublisher> {
  return Effect.gen(function* () {
    const publisher = yield* PayrollEventPublisher
    const occurredAt = yield* nowIso
    for (const change of payMonthChanges(before, after)) {
      if (change.kind === 'REOPENED') {
        yield* publisher.publish({
          type: 'payroll_pay_month.reopened',
          eventId: newId('event'),
          companyId,
          paymentMonth: change.paymentMonth,
          occurredAt,
        })
        continue
      }
      const ledgers = after.filter((ledger) => paymentMonthOf(ledger.paymentDate) === change.paymentMonth)
      yield* publisher.publish({
        type: 'payroll_pay_month.closed',
        eventId: newId('event'),
        companyId,
        paymentMonth: change.paymentMonth,
        ledgerIds: ledgers.map((ledger) => ledger.id),
        withholding: withholdingSummary(ledgers),
        occurredAt,
      })
    }
  })
}

function isWage(input: PayrollRowInputValue): boolean {
  return input.incomeType === 'WAGE_MONTHLY' || input.incomeType === 'WAGE_HOURLY' || input.incomeType === 'WAGE_DAILY'
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
 */
export function initialWageInput(
  employee: PayrollEmployee,
  period: { start: string; end: string },
): PayrollRowInputValue {
  if (employee.paymentUnit === 'HOURLY') return { incomeType: 'WAGE_HOURLY', hourlyWage: employee.hourlyWage }
  if (employee.paymentUnit === 'DAILY')
    return { incomeType: 'WAGE_DAILY', dailyWage: employee.dailyWage, workedDays: 0 }
  const from = employee.joinDate > period.start ? employee.joinDate : period.start
  const to = employee.leaveDate !== null && employee.leaveDate < period.end ? employee.leaveDate : period.end
  const totalDays = daysBetween(period.start, period.end) + 1
  const payableDays = Math.max(0, daysBetween(from, to) + 1)
  return {
    incomeType: 'WAGE_MONTHLY',
    basePay: employee.basePay,
    ...(payableDays < totalDays ? { proration: { method: 'CALENDAR_DAYS' as const, payableDays, totalDays } } : {}),
  }
}
