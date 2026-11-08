import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { paginate, type PageOf, type PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { Violation } from '../../../shared/problem/problem.types.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { WorkContractRepository, type WorkContractRecord } from '../contracts/work-contract.ts'
import { indefiniteConversion } from '../contracts/indefinite-conversion.ts'
import { InsuranceFilingRepository } from '../insurance-filings/insurance-filing-repository.ts'
import type { InsuranceFilingKind } from '../insurance-filings/insurance-filing.types.ts'
import { LeaveRepository, type LeaveRecord } from '../leaves/leave.ts'
import { OrganizationRepository } from '../organization/organization.ts'
import { SeveranceSettlementLookup } from '../ports/severance-settlement-lookup.ts'
import { checkResignation, isSeveranceSettled } from '../retirement/retirement-rules.ts'
import {
  birthDateFromRegistrationNumber,
  maskIdentityNumber,
  normalizeIdentityNumber,
} from '../shared/identity-number.ts'
import { PersonalDataAccessLog } from '../shared/personal-data-access-log.ts'
import { PersonalDataCipher } from '../shared/personal-data-cipher.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import type { EmployeeKind } from './employee-kind.types.ts'
import { findBlockingDuplicate } from './employee-duplicate.ts'
import { EmployeeRepository } from './employee-repository.ts'
import { deriveEmployeeStatus } from './employee-status.ts'
import type { EmployeeStatus } from './employee-status.types.ts'
import { employeeWarnings } from './employee-warnings.ts'
import {
  EmployeeDuplicate,
  EmployeeInvalid,
  EmployeeNotFound,
  ResignationRejected,
  RetirementCompleted,
  type CreateEmployee,
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

      const queueFiling = (record: EmployeeRecord, kind: InsuranceFilingKind, at: string) =>
        filings.save({
          id: newId('insuranceFiling'),
          companyId: record.companyId,
          employeeId: record.id,
          kind,
          source: { type: 'EMPLOYEE', id: record.id },
          payload: {},
          status: 'PENDING',
          requestedAt: at,
        })

      /** 주민번호·조직 단위를 검사하고 저장할 신원 필드를 만듭니다. */
      const resolveIdentity = Effect.fn('Employees.resolveIdentity')(function* (
        actor: Actor,
        kind: EmployeeKind,
        selfId: Id<'employee'> | undefined,
        isRejoin: boolean,
        input: {
          registrationNumber?: string
          identityType?: 'RRN' | 'PASSPORT'
          isForeigner: boolean
          departmentId?: Id<'department'> | null
          positionId?: Id<'position'> | null
        },
      ) {
        const violations: Violation[] = []
        const all = yield* units.list(actor.companyId)
        if (input.departmentId && !all.some((unit) => unit.kind === 'DEPARTMENT' && unit.id === input.departmentId)) {
          violations.push({ field: 'departmentId', code: 'NOT_FOUND' })
        }
        if (input.positionId && !all.some((unit) => unit.kind === 'POSITION' && unit.id === input.positionId)) {
          violations.push({ field: 'positionId', code: 'NOT_FOUND' })
        }
        if (input.registrationNumber === undefined) {
          if (violations.length > 0) return yield* new EmployeeInvalid({ violations })
          return {}
        }
        const type = input.identityType ?? (input.isForeigner ? 'PASSPORT' : 'RRN')
        const normalized = normalizeIdentityNumber(input.registrationNumber, type)
        if (normalized === null) violations.push({ field: 'registrationNumber', code: 'INVALID_FORMAT' })
        if (violations.length > 0 || normalized === null) return yield* new EmployeeInvalid({ violations })

        const hash = yield* cipher.hash(normalized)
        const [asOf, everyone, all2] = yield* Effect.all([
          today,
          employees.list(actor.companyId),
          related(actor.companyId),
        ])
        const candidates = everyone
          .filter((other) => other.kind === kind && other.registrationNumberHash === hash)
          .map((other) => ({ id: other.id, status: toView(other, asOf, all2).status }))
        const blocking = findBlockingDuplicate(candidates, { selfId, isRejoin })
        if (blocking !== undefined) {
          return yield* new EmployeeDuplicate({ duplicateEmployeeId: blocking as Id<'employee'> })
        }
        return {
          identityType: type,
          registrationNumberEncrypted: yield* cipher.encrypt('registrationNumber', normalized),
          registrationNumberHash: hash,
          registrationNumberMasked: maskIdentityNumber(normalized, type),
          ...(type === 'RRN' ? { derivedBirthDate: birthDateFromRegistrationNumber(normalized) ?? undefined } : {}),
        }
      })

      /** Payroll에 물어 퇴직금 정산이 끝난 직원이면 409입니다. */
      const guardSettlement = (record: EmployeeRecord) =>
        settlements
          .statusesOf(record.companyId, record.id)
          .pipe(
            Effect.flatMap((statuses) =>
              isSeveranceSettled(statuses) ? Effect.fail(new RetirementCompleted({})) : Effect.void,
            ),
          )

      const markAssigned = (record: EmployeeRecord) =>
        Effect.forEach(
          [record.departmentId, record.positionId].filter((id) => id !== undefined),
          (id) =>
            units.find(record.companyId, id).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.void,
                  onSome: (unit) => (unit.everAssigned ? Effect.void : units.save({ ...unit, everAssigned: true })),
                }),
              ),
            ),
          { discard: true },
        )

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
          const isRejoin = input.isRejoin ?? false
          const isForeigner = input.isForeigner ?? false
          const identity = yield* resolveIdentity(actor, input.kind, undefined, isRejoin, { ...input, isForeigner })
          const { derivedBirthDate, ...stored } = identity as typeof identity & { derivedBirthDate?: string }
          const now = yield* nowIso
          const record: EmployeeRecord = {
            id: newId('employee'),
            companyId: actor.companyId,
            kind: input.kind,
            name: input.name.trim(),
            ...stored,
            birthDate: input.birthDate ?? derivedBirthDate,
            joinDate: input.joinDate,
            isRejoin,
            departmentId: input.departmentId,
            positionId: input.positionId,
            email: input.email,
            phone: input.phone,
            isForeigner,
            nationalityCode: input.nationalityCode,
            visaCode: input.visaCode,
            version: 1,
            createdAt: now,
            updatedAt: now,
          }
          yield* employees.save(record)
          yield* markAssigned(record)
          if (record.kind === 'WAGE' && record.registrationNumberEncrypted !== undefined) {
            yield* queueFiling(record, 'ACQUISITION', now)
          }
          return yield* viewOf(record)
        }),

        update: Effect.fn('Employees.update')(function* (actor, id, patch, expectedVersion) {
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          const isForeigner = patch.isForeigner ?? record.isForeigner
          const identity = yield* resolveIdentity(actor, record.kind, record.id, record.isRejoin, {
            ...patch,
            isForeigner,
          })
          const { derivedBirthDate, ...stored } = identity as typeof identity & { derivedBirthDate?: string }
          const next: EmployeeRecord = {
            ...record,
            ...stored,
            name: patch.name?.trim() ?? record.name,
            birthDate: patch.birthDate ?? derivedBirthDate ?? record.birthDate,
            joinDate: patch.joinDate ?? record.joinDate,
            departmentId: patch.departmentId === undefined ? record.departmentId : (patch.departmentId ?? undefined),
            positionId: patch.positionId === undefined ? record.positionId : (patch.positionId ?? undefined),
            email: patch.email ?? record.email,
            phone: patch.phone ?? record.phone,
            isForeigner,
            nationalityCode: patch.nationalityCode ?? record.nationalityCode,
            visaCode: patch.visaCode ?? record.visaCode,
            version: record.version + 1,
            updatedAt: yield* nowIso,
          }
          yield* employees.save(next)
          yield* markAssigned(next)
          return yield* viewOf(next)
        }),

        remove: Effect.fn('Employees.remove')(function* (actor, id) {
          const record = yield* find(actor, id)
          yield* guardSettlement(record)
          yield* employees.remove(actor.companyId, id)
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
          yield* guardSettlement(record)
          const rejection = checkResignation(resignation, { joinDate: record.joinDate })
          if (rejection !== undefined) return yield* new ResignationRejected({ reason: rejection })
          const now = yield* nowIso
          const next: EmployeeRecord = { ...record, resignation, version: record.version + 1, updatedAt: now }
          yield* employees.save(next)
          yield* filings.withdraw(record.companyId, { type: 'EMPLOYEE', id: record.id }, 'LOSS', now)
          if (record.kind === 'WAGE') yield* queueFiling(next, 'LOSS', now)
          return yield* viewOf(next)
        }),

        cancelResignation: Effect.fn('Employees.cancelResignation')(function* (actor, id, expectedVersion) {
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          if (record.resignation === undefined) return yield* new ResignationRejected({ reason: 'NOT_RESIGNED' })
          yield* guardSettlement(record)
          const now = yield* nowIso
          const { resignation: _, ...rest } = record
          const next: EmployeeRecord = { ...rest, version: record.version + 1, updatedAt: now }
          yield* employees.save(next)
          yield* filings.withdraw(record.companyId, { type: 'EMPLOYEE', id: record.id }, 'LOSS', now)
          return yield* viewOf(next)
        }),
      })
    }),
  )
}
