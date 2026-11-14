import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { paginate, type PageOf, type PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { WorkContractRepository, type WorkContractRecord } from '../contracts/work-contract.ts'
import { indefiniteConversion } from '../contracts/indefinite-conversion.ts'
import { FamilyMemberRepository } from '../family/family-member.ts'
import { InsuranceFilingRepository, pendingFiling } from '../insurance-filings/insurance-filing-repository.ts'
import type { InsuranceFilingPayloads } from '../insurance-filings/insurance-filing.types.ts'
import { lossDateOf } from '../insurance-filings/insurance-filing-rules.ts'
import { LeaveRepository, type LeaveRecord } from '../leaves/leave.ts'
import { OrganizationRepository } from '../organization/organization.ts'
import { SeveranceSettlementLookup } from '../ports/severance-settlement-lookup.ts'
import { PersonalDataAccessLog } from '../../../shared/personal-data/personal-data-access-log.ts'
import { PersonalDataCipher } from '../../../shared/personal-data/personal-data-cipher.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import type { EmployeeKind } from './employee-kind.types.ts'
import {
  decideEmployeeCreation,
  decideEmployeeRemoval,
  decideEmployeeUpdate,
  decideResignation,
  decideResignationCancel,
  planEmployeeIdentity,
  type EmployeeIdentityFacts,
  type IdentityInput,
} from './employee.aggregate.ts'
import { EmployeeRepository } from './employee-repository.ts'
import { deriveEmployeeStatus } from './employee-status.ts'
import type { EmployeeStatus } from './employee-status.types.ts'
import { employeeWarnings } from './employee-warnings.ts'
import {
  EmployeeInvalid,
  EmployeeNotFound,
  type CreateEmployee,
  type EmployeeDuplicate,
  type ResignationRejected,
  type RetirementCompleted,
  type Employee,
  type EmployeeRecord,
  type Resignation,
  type UpdateEmployee,
} from './employee.ts'

/** 직원 목록 조건입니다. */
export interface EmployeeFilter extends PageQuery {
  asOf?: string
  kinds?: ReadonlyArray<EmployeeKind>
  statuses?: ReadonlyArray<EmployeeStatus>
}

/** 직원 관리입니다. 상태와 경고는 저장하지 않고 기준일로 계산합니다. */
export class Employees extends Context.Service<
  Employees,
  {
    list(actor: Actor, filter: EmployeeFilter): Effect.Effect<PageOf<Employee>>
    get(actor: Actor, id: Id<'employee'>): Effect.Effect<Employee, EmployeeNotFound>
    create(
      actor: Actor,
      input: typeof CreateEmployee.Type,
    ): Effect.Effect<Employee, EmployeeInvalid | EmployeeDuplicate>
    update(
      actor: Actor,
      id: Id<'employee'>,
      patch: typeof UpdateEmployee.Type,
      expectedVersion: number | undefined,
    ): Effect.Effect<Employee, EmployeeNotFound | EmployeeInvalid | EmployeeDuplicate | VersionMismatch>
    remove(actor: Actor, id: Id<'employee'>): Effect.Effect<void, EmployeeNotFound | RetirementCompleted>
    revealRegistrationNumber(
      actor: Actor,
      id: Id<'employee'>,
      reason: string,
    ): Effect.Effect<{ registrationNumber: string }, EmployeeNotFound>
    resign(
      actor: Actor,
      id: Id<'employee'>,
      resignation: typeof Resignation.Type,
      expectedVersion: number | undefined,
    ): Effect.Effect<Employee, EmployeeNotFound | ResignationRejected | RetirementCompleted | VersionMismatch>
    cancelResignation(
      actor: Actor,
      id: Id<'employee'>,
      expectedVersion: number | undefined,
    ): Effect.Effect<Employee, EmployeeNotFound | ResignationRejected | RetirementCompleted | VersionMismatch>
  }
>()('semu/hr/Employees') {
  static readonly layer = Layer.effect(
    Employees,
    Effect.gen(function* () {
      const employees = yield* EmployeeRepository
      const leaves = yield* LeaveRepository
      const contracts = yield* WorkContractRepository
      const units = yield* OrganizationRepository
      const filings = yield* InsuranceFilingRepository
      const family = yield* FamilyMemberRepository
      const cipher = yield* PersonalDataCipher
      const accessLog = yield* PersonalDataAccessLog
      const settlements = yield* SeveranceSettlementLookup

      const today = DateTime.now.pipe(Effect.map((now) => companyDate(DateTime.toEpochMillis(now))))
      const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso))

      const related = (companyId: Id<'company'>) =>
        Effect.all({ leaves: leaves.list(companyId), contracts: contracts.list(companyId) })

      const toView = (
        record: EmployeeRecord,
        asOf: string,
        all: { leaves: ReadonlyArray<LeaveRecord>; contracts: ReadonlyArray<WorkContractRecord> },
      ): Employee => {
        const ownLeaves = all.leaves.filter((leave) => leave.employeeId === record.id)
        const ownContracts = all.contracts.filter((contract) => contract.employeeId === record.id)
        const status = deriveEmployeeStatus(
          { joinDate: record.joinDate, leaveDate: record.resignation?.leaveDate, leaves: ownLeaves },
          asOf,
        )
        const warnings = employeeWarnings(
          {
            kind: record.kind,
            hasRegistrationNumber: record.registrationNumberEncrypted !== undefined,
            status,
            contracts: ownContracts,
            isIndefiniteConversionTarget: indefiniteConversion(ownContracts, record.birthDate, asOf).isTarget,
          },
          asOf,
        )
        const {
          companyId: _company,
          registrationNumberEncrypted: _encrypted,
          registrationNumberHash: _hash,
          ...visible
        } = record
        return { ...stripUndefined(visible), status, warnings }
      }

      const viewOf = (record: EmployeeRecord) =>
        Effect.all([today, related(record.companyId)]).pipe(Effect.map(([asOf, all]) => toView(record, asOf, all)))

      const find = (actor: Actor, id: Id<'employee'>) =>
        employees
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new EmployeeNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const queueFiling = <K extends 'ACQUISITION' | 'LOSS'>(
        record: EmployeeRecord,
        kind: K,
        payload: InsuranceFilingPayloads[K],
        at: string,
      ) =>
        filings.save(
          pendingFiling(
            { companyId: record.companyId, employeeId: record.id },
            kind,
            { type: 'EMPLOYEE', id: record.id },
            payload,
            at,
          ),
        )

      /**
       * 신원 판정에 넘길 사실을 읽습니다. 소속·번호 형식이 틀리면 번호를 봉인하기 전에 422입니다. 번호를 받았으면 해시·암호문을
       * 만들고, 같은 소득 구분에서 해시가 같은 직원과 그 지금 상태를 모읍니다.
       */
      const identityFacts = Effect.fn('Employees.identityFacts')(function* (
        companyId: Id<'company'>,
        kind: EmployeeKind,
        input: IdentityInput,
      ) {
        const all = yield* units.list(companyId)
        const plan = planEmployeeIdentity(input, all)
        if (plan.violations.length > 0) return yield* new EmployeeInvalid({ violations: plan.violations })
        if (plan.normalized === undefined) {
          return { units: all, sealed: undefined, sameNumber: [] } satisfies EmployeeIdentityFacts
        }
        const hash = yield* cipher.hash(plan.normalized.value)
        const [asOf, everyone, all2] = yield* Effect.all([today, employees.list(companyId), related(companyId)])
        const sameNumber = everyone
          .filter((other) => other.kind === kind && other.registrationNumberHash === hash)
          .map((other) => ({ id: other.id, status: toView(other, asOf, all2).status }))
        const encrypted = yield* cipher.encrypt('registrationNumber', plan.normalized.value)
        return { units: all, sealed: { hash, encrypted }, sameNumber } satisfies EmployeeIdentityFacts
      })

      const settlementsOf = (record: EmployeeRecord) => settlements.settlementsOf(record.companyId, record.id)

      return Employees.of({
        list: Effect.fn('Employees.list')(function* (actor, filter) {
          const asOf = filter.asOf ?? (yield* today)
          const [records, all] = yield* Effect.all([employees.list(actor.companyId), related(actor.companyId)])
          const views = records
            .map((record) => toView(record, asOf, all))
            .filter((view) => filter.kinds === undefined || filter.kinds.includes(view.kind))
            .filter((view) => filter.statuses === undefined || filter.statuses.includes(view.status))
          return paginate(views, (view) => view.id, filter, { includeTotal: true })
        }),

        get: (actor, id) => find(actor, id).pipe(Effect.flatMap(viewOf)),

        create: Effect.fn('Employees.create')(function* (actor, input) {
          const facts = yield* identityFacts(actor.companyId, input.kind, {
            ...input,
            isForeigner: input.isForeigner ?? false,
          })
          const now = yield* nowIso
          const { employee: record, assignedUnits } = yield* Effect.fromResult(
            decideEmployeeCreation({ ...input, id: newId('employee'), companyId: actor.companyId }, facts, now),
          )
          yield* employees.save(record)
          yield* Effect.forEach(assignedUnits, units.save, { discard: true })
          if (record.kind === 'WAGE' && record.registrationNumberEncrypted !== undefined) {
            yield* queueFiling(record, 'ACQUISITION', { acquisitionDate: record.joinDate }, now)
          }
          return yield* viewOf(record)
        }),

        update: Effect.fn('Employees.update')(function* (actor, id, patch, expectedVersion) {
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          const facts = yield* identityFacts(actor.companyId, record.kind, {
            ...patch,
            isForeigner: patch.isForeigner ?? record.isForeigner,
          })
          const { employee: next, assignedUnits } = yield* Effect.fromResult(
            decideEmployeeUpdate(record, patch, facts, yield* nowIso),
          )
          yield* employees.save(next)
          yield* Effect.forEach(assignedUnits, units.save, { discard: true })
          return yield* viewOf(next)
        }),

        remove: Effect.fn('Employees.remove')(function* (actor, id) {
          const record = yield* find(actor, id)
          yield* Effect.fromResult(decideEmployeeRemoval(yield* settlementsOf(record)))
          yield* employees.remove(actor.companyId, id)
          // 없는 직원의 신고가 대리인 큐에 남지 않게 열린 신고를 모두 닫습니다.
          yield* filings.withdrawEmployee(actor.companyId, id, yield* nowIso)
          // 가족은 주민번호를 담은 개인정보라 직원과 함께 지웁니다. 피부양자 상실 신고는 직원 상실 신고가 대신합니다.
          const members = (yield* family.list(actor.companyId)).filter((member) => member.employeeId === id)
          yield* Effect.forEach(members, (member) => family.remove(actor.companyId, member.id), { discard: true })
        }),

        revealRegistrationNumber: Effect.fn('Employees.revealRegistrationNumber')(function* (actor, id, reason) {
          const record = yield* find(actor, id)
          if (record.registrationNumberEncrypted === undefined) return yield* new EmployeeNotFound({})
          const registrationNumber = yield* cipher.decrypt('registrationNumber', record.registrationNumberEncrypted)
          yield* accessLog.record({
            companyId: actor.companyId,
            userId: actor.userId,
            target: `employee:${id}:registrationNumber`,
            reason,
            at: yield* nowIso,
          })
          return { registrationNumber }
        }),

        resign: Effect.fn('Employees.resign')(function* (actor, id, resignation, expectedVersion) {
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          const now = yield* nowIso
          const { employee: next } = yield* Effect.fromResult(
            decideResignation(record, resignation, yield* settlementsOf(record), now),
          )
          yield* employees.save(next)
          yield* filings.withdraw(record.companyId, { type: 'EMPLOYEE', id: record.id }, 'LOSS', now)
          if (record.kind === 'WAGE') {
            yield* queueFiling(
              next,
              'LOSS',
              {
                leaveDate: resignation.leaveDate,
                lossDate: lossDateOf(resignation.leaveDate),
                leavingReasonCode: resignation.leavingReasonCode,
                ...(resignation.leavingDetailReasonCode === undefined
                  ? {}
                  : { leavingDetailReasonCode: resignation.leavingDetailReasonCode }),
              },
              now,
            )
          }
          return yield* viewOf(next)
        }),

        cancelResignation: Effect.fn('Employees.cancelResignation')(function* (actor, id, expectedVersion) {
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          const now = yield* nowIso
          const { employee: next } = yield* Effect.fromResult(
            decideResignationCancel(record, yield* settlementsOf(record), now),
          )
          yield* employees.save(next)
          yield* filings.withdraw(record.companyId, { type: 'EMPLOYEE', id: record.id }, 'LOSS', now)
          return yield* viewOf(next)
        }),
      })
    }),
  )
}
