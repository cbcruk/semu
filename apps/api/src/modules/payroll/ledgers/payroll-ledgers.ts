import { Clock, Effect, Option } from 'effect'
import { paginate, type PageOf, type PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import type { Actor, Permission } from '../../identity-access/actor.types.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { EarnerRepository } from '../earners/earner-repository.ts'
import type { EarnerRecord } from '../earners/earner.ts'
import { PayrollItemRepository } from '../items/payroll-item-repository.ts'
import { LEDGER_PLANS } from '../payroll-access.ts'
import {
  AdditionalLedgerBlocked,
  EmployeeNotFound,
  PayrollLedgerHasAdditional,
  PayrollLedgerNotFound,
  PayrollLedgerReadOnly,
  PayrollLedgerTransitionInvalid,
  PayrollRowNotFound,
  PayrollRowItemInvalid,
  PayrollRowPayeeInvalid,
  RateTableNotFound,
  WageIncomeDuplicated,
  WageRowOnAdditionalLedger,
  WithholdingFiled,
} from '../payroll-problems.ts'
import { PayrollEmployeeDirectory, type PayrollEmployee } from '../ports/payroll-employee-directory.ts'
import { PayrollEventPublisher } from '../ports/payroll-events.ts'
import { PayrollPlanCheck } from '../ports/payroll-plan-check.ts'
import { WithholdingFilingLock } from '../ports/withholding-filing-lock.ts'
import { RateTableRepository } from '../rate-tables/rate-table-repository.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'
import { attributionMonthOn, paymentMonthOf } from './ledger-rules.ts'
import type { LedgerStatus, LedgerTransition } from './ledger-status.types.ts'
import {
  decideLedgerCreation,
  decideLedgerDeletion,
  decideLedgerHeaderUpdate,
  decideLedgerRecalculation,
  decideLedgerTransition,
  decideRowAddition,
  decideRowDeletion,
  decideRowUpdate,
  planLedgerCreation,
  type LedgerCalculationFacts,
  type LedgerDecision,
  type LedgerDecisionContext,
} from './payroll-ledger.aggregate.ts'
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
import type { PayrollLedgerRecord } from './payroll-ledger.types.ts'

/**
 * 급여대장 커맨드 처리기입니다. 읽기 → 권한 → 판정(`payroll-ledger.aggregate.ts`) → 저장만 합니다. 판정에 필요한 사실(같은 회사의
 * 대장, 기준표·설정·항목 카탈로그, 원천세 신고 여부, HR 직원·소득자 명부)은 여기서 읽어 넘기고, 판정이 만든 대장과 지급월 이벤트를
 * {@link save}가 함께 저장·발행합니다.
 */

/** 급여대장 유스케이스가 쓰는 저장소와 포트입니다. */
export type LedgerDeps =
  | PayrollLedgerRepository
  | PayrollSettingRepository
  | PayrollItemRepository
  | RateTableRepository
  | PayrollEmployeeDirectory
  | EarnerRepository
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
  | PayrollRowItemInvalid
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
    const ledger = yield* create(actor.companyId, payload)
    return yield* respond(actor, ledger)
  })

/** 정기 대장 자동 생성의 회사별 결과입니다. */
export type ScheduledLedgerOutcome = 'CREATED' | 'EXISTS' | 'DISABLED' | 'NO_PLAN' | 'WITHHOLDING_FILED'

/**
 * 정기 작업이 부르는 시스템 커맨드입니다. 설정(`autoCreateRegularLedger`)을 켠 회사에 `today`가 든 임금산정 기간의 귀속월
 * 정기 대장을 만듭니다. 행위자가 없어 권한·약관 검사는 하지 않고, 플랜은 {@link PayrollPlanCheck}로 봅니다.
 *
 * - 설정을 껐으면 `DISABLED`, 급여대장 플랜이 없으면 `NO_PLAN`
 * - 그 귀속월에 대장이 하나라도 있으면(사람이 먼저 만들었거나 이미 만든 슬롯) `EXISTS`. 그래서 같은 날 다시 돌려도 결과가 같습니다
 * - 기본 지급일의 지급월에 원천세가 신고됐으면 `WITHHOLDING_FILED`(만들지 않음)
 */
export const createScheduledRegularLedger = (
  companyId: Id<'company'>,
  today: string,
): Effect.Effect<ScheduledLedgerOutcome, RateTableNotFound, LedgerDeps | PayrollPlanCheck> =>
  Effect.gen(function* () {
    const setting = yield* (yield* PayrollSettingRepository).get(companyId)
    if (!setting.autoCreateRegularLedger) return 'DISABLED'
    const plans = yield* (yield* PayrollPlanCheck).plansOf(companyId)
    if (!LEDGER_PLANS.some((plan) => plans.has(plan))) return 'NO_PLAN'
    const attributionMonth = attributionMonthOn(today, setting.wagePeriodStartDay)
    const ledgers = yield* (yield* PayrollLedgerRepository).list(companyId)
    if (ledgers.some((ledger) => ledger.attributionMonth === attributionMonth)) return 'EXISTS'
    return yield* create(companyId, { attributionMonth }).pipe(
      Effect.as('CREATED' as const),
      Effect.catchTag('WithholdingFiled', () => Effect.succeed('WITHHOLDING_FILED' as const)),
      // 귀속월에 대장이 없으므로 정기 대장이고, 추가 대장 규칙은 걸리지 않습니다.
      Effect.catchTag('AdditionalLedgerBlocked', (error) => Effect.die(error)),
    )
  })

/**
 * 대장 머리(제목·지급일)를 고칩니다. 신고 잠금은 변경이 건드리는 지급월을 봅니다. 신고된 달로 지급일을 옮기거나 신고된 달 안에서
 * 고칠 수 없지만, 마감 전 대장을 신고된 달에서 빼낼 수는 있습니다.
 */
export const updateLedger = (
  id: Id<'payrollLedger'>,
  patch: typeof UpdatePayrollLedger.Type,
  expected: number | undefined,
): Run<LedgerResponse> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, ledgers } = yield* load(actor, id, expected)
    const months = [paymentMonthOf(ledger.paymentDate), paymentMonthOf(patch.paymentDate ?? ledger.paymentDate)]
    const facts = { ledgers, filedPaymentMonths: yield* filedAmong(actor.companyId, months) }
    const calculation = yield* calculationFacts(actor.companyId)
    const decision = yield* Effect.fromResult(
      decideLedgerHeaderUpdate(ledger, patch, { ...facts, ...calculation }, yield* contextOf(actor)),
    )
    yield* save(decision)
    return yield* respond(actor, decision.ledger)
  })

/** 입력 중인 대장을 지웁니다. 추가 대장이 딸린 정기 대장은 추가 대장을 먼저 지워야 합니다. */
export const deleteLedger = (id: Id<'payrollLedger'>, expected: number | undefined): Run<void> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:delete', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, ledgers } = yield* load(actor, id, expected)
    const facts = {
      ledgers,
      filedPaymentMonths: yield* filedAmong(actor.companyId, [paymentMonthOf(ledger.paymentDate)]),
    }
    const decision = yield* Effect.fromResult(decideLedgerDeletion(ledger, facts, yield* contextOf(actor)))
    yield* (yield* PayrollLedgerRepository).remove(actor.companyId, id)
    yield* publish(decision.events)
  })

/** 행을 추가하고 바로 계산합니다. */
export const addRow = (
  id: Id<'payrollLedger'>,
  payload: typeof AddPayrollRow.Type,
  expected: number | undefined,
): Run<{ ledger: PayrollLedgerRecord; row: RowResponse }> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, ledgers } = yield* load(actor, id, expected)
    const employee =
      payload.employeeId === undefined
        ? Option.none<PayrollEmployee>()
        : yield* (yield* PayrollEmployeeDirectory).find(actor.companyId, payload.employeeId, ledger.wagePeriod.end)
    const earner =
      payload.earnerId === undefined
        ? Option.none<EarnerRecord>()
        : yield* (yield* EarnerRepository).find(actor.companyId, payload.earnerId)
    const facts = {
      ledgers,
      filedPaymentMonths: yield* filedAmong(actor.companyId, [paymentMonthOf(ledger.paymentDate)]),
      ...(yield* calculationFacts(actor.companyId)),
      employee: Option.getOrUndefined(employee),
      earner: Option.getOrUndefined(earner),
    }
    const decision = yield* Effect.fromResult(decideRowAddition(ledger, payload, facts, yield* contextOf(actor)))
    yield* save(decision)
    return { ledger: decision.ledger, row: rowResponse(decision.ledger, decision.row) }
  })

/** 행 입력을 고치고 다시 계산합니다. 소득 구분은 바꿀 수 없습니다. 소득자는 행을 다시 넣어야 바뀝니다. */
export const updateRow = (
  id: Id<'payrollLedger'>,
  rowId: Id<'payrollRow'>,
  patch: typeof UpdatePayrollRow.Type,
  expected: number | undefined,
): Run<{ ledger: PayrollLedgerRecord; row: RowResponse }> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, ledgers } = yield* load(actor, id, expected)
    const facts = {
      ledgers,
      filedPaymentMonths: yield* filedAmong(actor.companyId, [paymentMonthOf(ledger.paymentDate)]),
      ...(yield* calculationFacts(actor.companyId)),
    }
    const decision = yield* Effect.fromResult(
      decideRowUpdate(ledger, rowId, patch.input, facts, yield* contextOf(actor)),
    )
    yield* save(decision)
    return { ledger: decision.ledger, row: rowResponse(decision.ledger, decision.row) }
  })

/** 행을 지웁니다. */
export const deleteRow = (id: Id<'payrollLedger'>, rowId: Id<'payrollRow'>, expected: number | undefined): Run<void> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, ledgers } = yield* load(actor, id, expected)
    const facts = {
      ledgers,
      filedPaymentMonths: yield* filedAmong(actor.companyId, [paymentMonthOf(ledger.paymentDate)]),
    }
    yield* save(yield* Effect.fromResult(decideRowDeletion(ledger, rowId, facts, yield* contextOf(actor))))
  })

/**
 * HR 정보와 소득자 명부를 다시 읽어 행의 사본(계산 입력·이름·소득자)을 갱신하고 모든 행을 다시 계산합니다.
 * 기준표·설정·명부가 바뀐 뒤에 씁니다. 직원이나 소득자가 없어졌으면 그 행의 사본은 그대로 둡니다.
 */
export const recalculateLedger = (id: Id<'payrollLedger'>, expected: number | undefined): Run<LedgerResponse> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-ledger:update', plans: LEDGER_PLANS, requiresTerms: true })
    const { ledger, ledgers } = yield* load(actor, id, expected)
    const directory = yield* PayrollEmployeeDirectory
    const registry = yield* EarnerRepository
    const employees = new Map<Id<'employee'>, PayrollEmployee>()
    const earners = new Map<Id<'earner'>, EarnerRecord>()
    for (const row of ledger.rows) {
      if (row.employeeId !== null) {
        const found = yield* directory.find(actor.companyId, row.employeeId, ledger.wagePeriod.end)
        if (Option.isSome(found)) employees.set(row.employeeId, found.value)
      } else if (row.earnerId !== null) {
        const found = yield* registry.find(actor.companyId, row.earnerId)
        if (Option.isSome(found)) earners.set(row.earnerId, found.value)
      }
    }
    const facts = {
      ledgers,
      filedPaymentMonths: yield* filedAmong(actor.companyId, [paymentMonthOf(ledger.paymentDate)]),
      ...(yield* calculationFacts(actor.companyId)),
      employees,
      earners,
    }
    const decision = yield* Effect.fromResult(decideLedgerRecalculation(ledger, facts, yield* contextOf(actor)))
    yield* save(decision)
    return yield* respond(actor, decision.ledger)
  })

/**
 * 상태 커맨드를 실행합니다. 전이표가 허락해야 하고, 입력을 마치는 전이(제출·직접 마감)는 모든 행을 다시 계산합니다.
 * 지급월의 대장이 모두 마감되거나 마감이 풀리면 이벤트를 냅니다.
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
    const { ledger, ledgers } = yield* load(actor, id, expected)
    const facts = {
      ledgers,
      filedPaymentMonths: yield* filedAmong(actor.companyId, [paymentMonthOf(ledger.paymentDate)]),
      ...(yield* calculationFacts(actor.companyId)),
    }
    const decision = yield* Effect.fromResult(
      decideLedgerTransition(ledger, transition, reason, facts, yield* contextOf(actor)),
    )
    yield* save(decision)
    return yield* respond(actor, decision.ledger)
  })

const nowIso = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString())

/** 대장을 만듭니다. 요청과 정기 작업이 함께 씁니다. */
function create(
  companyId: Id<'company'>,
  payload: { attributionMonth: string; paymentDate?: string | undefined; title?: string | undefined },
): Effect.Effect<PayrollLedgerRecord, AdditionalLedgerBlocked | WithholdingFiled | RateTableNotFound, LedgerDeps> {
  return Effect.gen(function* () {
    const ledgers = yield* (yield* PayrollLedgerRepository).list(companyId)
    const calculation = yield* calculationFacts(companyId)
    const plan = planLedgerCreation(payload, ledgers, calculation.setting)
    const wageEarners =
      plan.kind === 'REGULAR'
        ? yield* (yield* PayrollEmployeeDirectory).listWageEarners(companyId, plan.wagePeriod)
        : []
    const facts = {
      ledgers,
      filedPaymentMonths: yield* filedAmong(companyId, [paymentMonthOf(plan.paymentDate)]),
      ...calculation,
      wageEarners,
    }
    const decision = yield* Effect.fromResult(
      decideLedgerCreation({ ...payload, id: newId('payrollLedger'), companyId }, facts, yield* nowIso),
    )
    yield* save(decision)
    return decision.ledger
  })
}

/** 같은 회사의 대장을 모두 읽고 그중 대상을 찾습니다. 버전(`If-Match`)을 봅니다. */
function load(
  actor: Actor,
  id: Id<'payrollLedger'>,
  expected: number | undefined,
): Effect.Effect<
  { ledger: PayrollLedgerRecord; ledgers: ReadonlyArray<PayrollLedgerRecord> },
  PayrollLedgerNotFound | VersionMismatch,
  PayrollLedgerRepository
> {
  return Effect.gen(function* () {
    const ledgers = yield* (yield* PayrollLedgerRepository).list(actor.companyId)
    const ledger = ledgers.find((candidate) => candidate.id === id)
    if (ledger === undefined) return yield* new PayrollLedgerNotFound({})
    yield* checkVersion(ledger.version, expected)
    return { ledger, ledgers }
  })
}

/** 판정 문맥입니다. */
function contextOf(actor: Actor): Effect.Effect<LedgerDecisionContext> {
  return Effect.map(nowIso, (at) => ({ at, actor: { kind: actor.kind } }))
}

/** 행 계산에 쓰는 기준표 전체와 회사 설정·항목 카탈로그입니다. */
function calculationFacts(
  companyId: Id<'company'>,
): Effect.Effect<
  LedgerCalculationFacts,
  never,
  RateTableRepository | PayrollSettingRepository | PayrollItemRepository
> {
  return Effect.gen(function* () {
    const tables = yield* (yield* RateTableRepository).list()
    return {
      rateTables: tables.map((record) => record.table),
      setting: yield* (yield* PayrollSettingRepository).get(companyId),
      catalog: yield* (yield* PayrollItemRepository).catalog(companyId),
    }
  })
}

/** `paymentMonths` 중 원천세가 신고된 달입니다. */
function filedAmong(
  companyId: Id<'company'>,
  paymentMonths: readonly string[],
): Effect.Effect<ReadonlySet<string>, never, WithholdingFilingLock> {
  return Effect.gen(function* () {
    const lock = yield* WithholdingFilingLock
    const filed = new Set<string>()
    for (const paymentMonth of new Set(paymentMonths)) {
      if (yield* lock.isFiled(companyId, paymentMonth)) filed.add(paymentMonth)
    }
    return filed
  })
}

/** 판정한 대장을 저장하고 그 변경이 낸 지급월 이벤트를 냅니다. */
function save(decision: LedgerDecision): Effect.Effect<void, never, PayrollLedgerRepository | PayrollEventPublisher> {
  return Effect.gen(function* () {
    yield* (yield* PayrollLedgerRepository).save(decision.ledger)
    yield* publish(decision.events)
  })
}

function publish(events: LedgerDecision['events']): Effect.Effect<void, never, PayrollEventPublisher> {
  return Effect.gen(function* () {
    const publisher = yield* PayrollEventPublisher
    for (const event of events) yield* publisher.publish(event)
  })
}

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
