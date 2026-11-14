import { Clock, Effect, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { PayrollLedgerRepository } from '../ledgers/payroll-ledger-repository.ts'
import {
  EmployeeNotFound,
  type RateTableNotFound,
  WageSettlementExists,
  WageSettlementNotApplicable,
  WageSettlementNotFound,
  WageSettlementPaymentDateInvalid,
  WageSettlementTransitionInvalid,
  WithholdingFiled,
} from '../payroll-problems.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayrollEventPublisher } from '../ports/payroll-events.ts'
import { WithholdingFilingLock } from '../ports/withholding-filing-lock.ts'
import { RateTableRepository } from '../rate-tables/rate-table-repository.ts'
import {
  type CreateWageTaxSettlement,
  type UpdateWageTaxSettlement,
  type WageTaxSettlement,
  wageSettlementResponse,
} from './wage-tax-settlement.ts'
import { WageTaxSettlementRepository } from './wage-tax-settlement-repository.ts'
import {
  completionPaymentDate,
  decideWageSettlementCreation,
  decideWageSettlementDeletion,
  decideWageSettlementTransition,
  decideWageSettlementUpdate,
  wageSettlementBasisDate,
  type WageSettlementDecision,
  type WageSettlementFacts,
} from './wage-tax-settlement.aggregate.ts'
import type { WageSettlementKind, WageSettlementStatus, WageTaxSettlementRecord } from './wage-tax-settlement.types.ts'

/** 근로소득 정산 유스케이스가 쓰는 저장소와 포트입니다. */
export type WageSettlementDeps =
  | WageTaxSettlementRepository
  | PayrollLedgerRepository
  | PayrollEmployeeDirectory
  | RateTableRepository
  | WithholdingFilingLock
  | PayrollEventPublisher

type Response = typeof WageTaxSettlement.Type
type WageSettlementError =
  | AccessDenied
  | VersionMismatch
  | WageSettlementNotFound
  | WageSettlementNotApplicable
  | WageSettlementExists
  | WageSettlementTransitionInvalid
  | WageSettlementPaymentDateInvalid
  | EmployeeNotFound
  | RateTableNotFound
  | WithholdingFiled
type Run<A, E = WageSettlementError> = Effect.Effect<A, E, CurrentActor | WageSettlementDeps>

const PLANS = ['PAYROLL'] as const

/** 근로소득 정산 목록입니다. 과세연도·상태·지급월(확정한 정산이 원천세에 들어가는 달)로 거릅니다. */
export const listWageSettlements = (filter: {
  readonly year?: string
  readonly status?: WageSettlementStatus
  readonly paymentMonth?: string
}): Run<{ items: Response[] }, AccessDenied> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:read', plans: PLANS, requiresTerms: true })
    const records = (yield* (yield* WageTaxSettlementRepository).list(actor.companyId))
      .filter((record) => filter.year === undefined || record.year === filter.year)
      .filter((record) => filter.status === undefined || record.status === filter.status)
      .filter((record) => filter.paymentMonth === undefined || record.paymentDate?.slice(0, 7) === filter.paymentMonth)
    return { items: records.map(wageSettlementResponse) }
  })

/** 근로소득 정산 하나입니다. */
export const getWageSettlement = (id: Id<'wageTaxSettlement'>): Run<Response, AccessDenied | WageSettlementNotFound> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:read', plans: PLANS, requiresTerms: true })
    return wageSettlementResponse(yield* findOrFail(actor.companyId, id))
  })

/**
 * 중도퇴사자 연말정산(`MID_YEAR`)이나 연말정산(`ANNUAL`)을 계산해 만듭니다. 같은 직원·연도·종류의 정산이 있으면 409입니다.
 * 공제대상가족 수는 퇴사일(연말정산은 12월 31일)의 HR 값이고, 근로소득은 그해 귀속의 마감된 대장 행입니다.
 */
export const createWageSettlement = (payload: typeof CreateWageTaxSettlement.Type): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:create', plans: PLANS, requiresTerms: true })
    const now = yield* nowIso
    const facts = {
      ...(yield* factsOf(actor.companyId, payload.employeeId, payload.kind, payload.year, now, [payload.paymentDate])),
      settlements: yield* (yield* WageTaxSettlementRepository).list(actor.companyId),
    }
    const decision = yield* Effect.fromResult(
      decideWageSettlementCreation(
        { ...payload, id: newId('wageTaxSettlement'), companyId: actor.companyId },
        facts,
        now,
      ),
    )
    yield* save(decision)
    return wageSettlementResponse(decision.settlement)
  })

/** 계산됨 정산의 입력·지급일을 고치고, 그해 마감된 대장과 HR 공제대상가족 수로 다시 계산합니다. */
export const updateWageSettlement = (
  id: Id<'wageTaxSettlement'>,
  patch: typeof UpdateWageTaxSettlement.Type,
  expected: number | undefined,
): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:update', plans: PLANS, requiresTerms: true })
    const record = yield* findOrFail(actor.companyId, id)
    yield* checkVersion(record.version, expected)
    const now = yield* nowIso
    const facts = yield* factsOf(record.companyId, record.employeeId, record.kind, record.year, now, [
      record.paymentDate,
      patch.paymentDate ?? undefined,
    ])
    const decision = yield* Effect.fromResult(decideWageSettlementUpdate(record, patch, facts, now))
    yield* save(decision)
    return wageSettlementResponse(decision.settlement)
  })

/**
 * 확정(`:complete`)과 다시 열기(`:reopen`)입니다.
 *
 * 확정은 그해 마감된 대장으로 다시 계산해 그 값을 굳힙니다. 계산한 뒤 대장이 다시 열리거나 마감돼도 확정한 금액이 그때의 대장과
 * 맞게 하려는 것입니다. 지급일이 없으면 기본값(중도퇴사는 퇴사일, 연말정산은 다음 해 2월 말일)을 채우고, 그 달 원천세에 들어갑니다.
 */
export const transitionWageSettlement = (
  id: Id<'wageTaxSettlement'>,
  command: 'COMPLETE' | 'REOPEN',
  expected: number | undefined,
): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:complete', plans: PLANS, requiresTerms: true })
    const record = yield* findOrFail(actor.companyId, id)
    yield* checkVersion(record.version, expected)
    const now = yield* nowIso
    const facts = yield* factsOf(record.companyId, record.employeeId, record.kind, record.year, now, [
      record.paymentDate,
      completionPaymentDate(record),
    ])
    const decision = yield* Effect.fromResult(decideWageSettlementTransition(record, command, facts, now))
    yield* save(decision)
    return wageSettlementResponse(decision.settlement)
  })

/** 계산됨 정산을 지웁니다. 확정한 정산은 다시 열어야 지울 수 있습니다. 원천세 합계에 들지 않아 신호·잠금이 없습니다. */
export const deleteWageSettlement = (
  id: Id<'wageTaxSettlement'>,
): Run<void, AccessDenied | WageSettlementNotFound | WageSettlementTransitionInvalid> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:delete', plans: PLANS, requiresTerms: true })
    const record = yield* findOrFail(actor.companyId, id)
    yield* Effect.fromResult(decideWageSettlementDeletion(record))
    yield* (yield* WageTaxSettlementRepository).remove(actor.companyId, id)
  })

const nowIso = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString())

/**
 * 판정이 받는 사실을 읽습니다. HR 직원은 오늘과 정산 기준일로 두 번 읽고, 급여대장·기준표 전체와 `dates`의 지급월 신고 잠금을 읽습니다.
 */
function factsOf(
  companyId: Id<'company'>,
  employeeId: Id<'employee'>,
  kind: WageSettlementKind,
  year: string,
  now: string,
  dates: ReadonlyArray<string | undefined>,
): Effect.Effect<
  WageSettlementFacts,
  never,
  PayrollEmployeeDirectory | PayrollLedgerRepository | RateTableRepository | WithholdingFilingLock
> {
  return Effect.gen(function* () {
    const today = companyDate(Date.parse(now))
    const directory = yield* PayrollEmployeeDirectory
    const employeeNow = Option.getOrUndefined(yield* directory.find(companyId, employeeId, today))
    const employeeAtBasis =
      employeeNow === undefined
        ? undefined
        : Option.getOrUndefined(
            yield* directory.find(companyId, employeeId, wageSettlementBasisDate(kind, year, employeeNow.leaveDate)),
          )
    const lock = yield* WithholdingFilingLock
    const filedPaymentMonths = new Set<string>()
    for (const month of new Set(dates.filter((date) => date !== undefined).map((date) => date.slice(0, 7)))) {
      if (yield* lock.isFiled(companyId, month)) filedPaymentMonths.add(month)
    }
    return {
      employeeNow,
      employeeAtBasis,
      ledgers: yield* (yield* PayrollLedgerRepository).list(companyId),
      rateTables: (yield* (yield* RateTableRepository).list()).map((record) => record.table),
      filedPaymentMonths,
      today,
    }
  })
}

/** 판정한 정산을 저장하고 원천세 합계가 바뀐 지급월 이벤트를 냅니다. */
function save(
  decision: WageSettlementDecision,
): Effect.Effect<void, never, WageTaxSettlementRepository | PayrollEventPublisher> {
  return Effect.gen(function* () {
    yield* (yield* WageTaxSettlementRepository).save(decision.settlement)
    const publisher = yield* PayrollEventPublisher
    for (const event of decision.events) yield* publisher.publish(event)
  })
}

function findOrFail(
  companyId: Id<'company'>,
  id: Id<'wageTaxSettlement'>,
): Effect.Effect<WageTaxSettlementRecord, WageSettlementNotFound, WageTaxSettlementRepository> {
  return Effect.gen(function* () {
    const found = yield* (yield* WageTaxSettlementRepository).find(companyId, id)
    if (Option.isNone(found)) return yield* new WageSettlementNotFound({})
    return found.value
  })
}
