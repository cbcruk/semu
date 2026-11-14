import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { PersonalDataAccessLog } from '../../../shared/personal-data/personal-data-access-log.ts'
import { PersonalDataCipher } from '../../../shared/personal-data/personal-data-cipher.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeNotFound, type EmployeeKindNotSupported } from '../employees/employee.ts'
import { InsuranceFilingRepository, pendingFiling } from '../insurance-filings/insurance-filing-repository.ts'
import {
  decideFamilyMemberCreation,
  decideFamilyMemberRemoval,
  decideFamilyMemberUpdate,
  planFamilyMember,
  planFamilyMemberCreation,
  type DependantFiling,
  type DependantFilingChange,
  type FamilyMemberPlan,
} from './family-member.aggregate.ts'
import {
  FamilyMemberNotFound,
  FamilyMemberRepository,
  type FamilyMember,
  type FamilyMemberDependantRegistered,
  type FamilyMemberInput,
  type FamilyMemberInvalid,
  type FamilyMemberRecord,
} from './family-member.ts'

/**
 * 근로소득자의 가족(인적공제 대상자) 관리입니다. 근로소득자(`WAGE`)만 가질 수 있습니다.
 *
 * 연말정산 대상 가족은 소득세 공제 설정의 공제대상 가족 수가 됩니다. 건강보험 피부양자 여부를 바꾸면 피부양자
 * 취득·상실 신고를 맞춥니다.
 */
export class FamilyMembers extends Context.Service<
  FamilyMembers,
  {
    list(actor: Actor, employeeId: Id<'employee'>): Effect.Effect<{ items: FamilyMember[] }, EmployeeNotFound>
    get(actor: Actor, id: Id<'familyMember'>): Effect.Effect<FamilyMember, FamilyMemberNotFound>
    create(
      actor: Actor,
      employeeId: Id<'employee'>,
      input: FamilyMemberInput,
    ): Effect.Effect<FamilyMember, EmployeeNotFound | EmployeeKindNotSupported | FamilyMemberInvalid>
    update(
      actor: Actor,
      id: Id<'familyMember'>,
      input: FamilyMemberInput,
      expectedVersion: number | undefined,
    ): Effect.Effect<FamilyMember, FamilyMemberNotFound | FamilyMemberInvalid | VersionMismatch>
    remove(
      actor: Actor,
      id: Id<'familyMember'>,
    ): Effect.Effect<void, FamilyMemberNotFound | FamilyMemberDependantRegistered>
    revealRegistrationNumber(
      actor: Actor,
      id: Id<'familyMember'>,
      reason: string,
    ): Effect.Effect<{ registrationNumber: string }, FamilyMemberNotFound>
  }
>()('semu/hr/FamilyMembers') {
  static readonly layer = Layer.effect(
    FamilyMembers,
    Effect.gen(function* () {
      const members = yield* FamilyMemberRepository
      const employees = yield* EmployeeRepository
      const filings = yield* InsuranceFilingRepository
      const cipher = yield* PersonalDataCipher
      const accessLog = yield* PersonalDataAccessLog

      const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso))
      const today = DateTime.now.pipe(Effect.map((now) => companyDate(DateTime.toEpochMillis(now))))

      const findEmployee = (actor: Actor, id: Id<'employee'>) =>
        employees
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new EmployeeNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const findMember = (actor: Actor, id: Id<'familyMember'>) =>
        members
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new FamilyMemberNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const toView = ({ companyId: _, registrationNumberEncrypted: _encrypted, ...rest }: FamilyMemberRecord) =>
        stripUndefined(rest) as FamilyMember

      /** 검사를 통과한 입력의 번호를 봉인합니다. */
      const seal = (plan: FamilyMemberPlan) =>
        plan.registrationNumber === undefined
          ? Effect.succeed(undefined)
          : cipher.encrypt('registrationNumber', plan.registrationNumber)

      const dependantFilingsOf = (member: Pick<FamilyMemberRecord, 'id' | 'companyId' | 'employeeId'>) =>
        filings
          .listByEmployee(member.companyId, member.employeeId)
          .pipe(
            Effect.map((all) =>
              all.filter(
                (filing): filing is DependantFiling =>
                  filing.kind === 'DEPENDANT' &&
                  filing.source.type === 'FAMILY_MEMBER' &&
                  filing.source.id === member.id,
              ),
            ),
          )

      /** 판정이 알려 준 피부양자 신고 변경을 그 순서대로 합니다. */
      const applyFilings = Effect.fn('FamilyMembers.applyFilings')(function* (
        member: FamilyMemberRecord,
        changes: ReadonlyArray<DependantFilingChange>,
      ) {
        if (changes.length === 0) return
        const at = yield* nowIso
        const source = { type: 'FAMILY_MEMBER', id: member.id } as const
        for (const change of changes) {
          if (change.action === 'WITHDRAW') yield* filings.withdraw(member.companyId, source, 'DEPENDANT', at)
          else
            yield* filings.save(
              pendingFiling(
                { companyId: member.companyId, employeeId: member.employeeId },
                'DEPENDANT',
                source,
                change.payload,
                at,
              ),
            )
        }
      })

      return FamilyMembers.of({
        list: Effect.fn('FamilyMembers.list')(function* (actor, employeeId) {
          yield* findEmployee(actor, employeeId)
          const all = yield* members.list(actor.companyId)
          return { items: all.filter((member) => member.employeeId === employeeId).map(toView) }
        }),

        get: Effect.fn('FamilyMembers.get')(function* (actor, id) {
          return toView(yield* findMember(actor, id))
        }),

        create: Effect.fn('FamilyMembers.create')(function* (actor, employeeId, input) {
          const employee = yield* findEmployee(actor, employeeId)
          const plan = yield* Effect.fromResult(planFamilyMemberCreation(input, yield* today, employee.kind))
          const owner = { id: newId('familyMember'), companyId: actor.companyId, employeeId }
          const { member, filings: changes } = decideFamilyMemberCreation(
            owner,
            plan,
            yield* seal(plan),
            yield* dependantFilingsOf(owner),
          )
          yield* members.save(member)
          yield* applyFilings(member, changes)
          return toView(member)
        }),

        update: Effect.fn('FamilyMembers.update')(function* (actor, id, input, expectedVersion) {
          const current = yield* findMember(actor, id)
          yield* checkVersion(current.version, expectedVersion)
          const plan = yield* Effect.fromResult(planFamilyMember(input, yield* today))
          const { member, filings: changes } = decideFamilyMemberUpdate(
            current,
            plan,
            yield* seal(plan),
            yield* dependantFilingsOf(current),
          )
          yield* members.save(member)
          yield* applyFilings(member, changes)
          return toView(member)
        }),

        remove: Effect.fn('FamilyMembers.remove')(function* (actor, id) {
          const member = yield* findMember(actor, id)
          const { filings: changes } = yield* Effect.fromResult(
            decideFamilyMemberRemoval(member, yield* dependantFilingsOf(member)),
          )
          yield* members.remove(actor.companyId, member.id)
          yield* applyFilings(member, changes)
        }),

        revealRegistrationNumber: Effect.fn('FamilyMembers.revealRegistrationNumber')(function* (actor, id, reason) {
          const member = yield* findMember(actor, id)
          if (member.registrationNumberEncrypted === undefined) return yield* new FamilyMemberNotFound({})
          const registrationNumber = yield* cipher.decrypt('registrationNumber', member.registrationNumberEncrypted)
          yield* accessLog.record({
            companyId: actor.companyId,
            userId: actor.userId,
            target: `familyMember:${id}:registrationNumber`,
            reason,
            at: yield* nowIso,
          })
          return { registrationNumber }
        }),
      })
    }),
  )
}
