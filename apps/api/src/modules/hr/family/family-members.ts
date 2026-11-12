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
import { EmployeeKindNotSupported, EmployeeNotFound } from '../employees/employee.ts'
import { InsuranceFilingRepository, pendingFiling } from '../insurance-filings/insurance-filing-repository.ts'
import { OPEN_STATUSES } from '../insurance-filings/insurance-filing-rules.ts'
import type { InsuranceFiling, InsuranceFilingPayloads } from '../insurance-filings/insurance-filing.types.ts'
import { maskIdentityNumber } from '../shared/identity-number.ts'
import { dependantChange, isRegisteredDependant, validateFamilyMember } from './family-member-rules.ts'
import {
  FamilyMemberDependantRegistered,
  FamilyMemberInvalid,
  FamilyMemberNotFound,
  FamilyMemberRepository,
  type FamilyMember,
  type FamilyMemberInput,
  type FamilyMemberRecord,
} from './family-member.ts'

type DependantFiling = Extract<InsuranceFiling, { kind: 'DEPENDANT' }>

function samePayload(a: InsuranceFilingPayloads['DEPENDANT'], b: InsuranceFilingPayloads['DEPENDANT']): boolean {
  return (
    a.familyMemberId === b.familyMemberId &&
    a.change === b.change &&
    a.name === b.name &&
    a.relation === b.relation &&
    a.birthDate === b.birthDate
  )
}

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

      /** 입력을 검사해 저장할 필드를 만듭니다. 주민번호를 비우면 지웁니다. */
      const resolve = Effect.fn('FamilyMembers.resolve')(function* (input: FamilyMemberInput) {
        const terms = {
          relation: input.relation,
          birthDate: input.birthDate,
          registrationNumber: input.registrationNumber,
          taxFreeTarget: input.taxFreeTarget ?? false,
          yearEndTarget: input.yearEndTarget ?? false,
          yearEndDependantType: input.yearEndDependantType ?? 'NOT_ELIGIBLE',
          healthInsuranceDependant: input.healthInsuranceDependant ?? false,
        }
        const result = validateFamilyMember(terms, yield* today)
        if (result.violations.length > 0) return yield* new FamilyMemberInvalid({ violations: result.violations })
        const { registrationNumber: _, ...fields } = terms
        return {
          ...fields,
          name: input.name,
          isForeigner: input.isForeigner ?? false,
          registrationNumberEncrypted:
            result.registrationNumber === undefined
              ? undefined
              : yield* cipher.encrypt('registrationNumber', result.registrationNumber),
          registrationNumberMasked:
            result.registrationNumber === undefined ? undefined : maskIdentityNumber(result.registrationNumber, 'RRN'),
        }
      })

      /**
       * 피부양자 신고를 가족의 지금 상태에 맞춥니다. 공단에 등록된 상태(마지막 완료 신고)와 원하는 상태가 다르면 취득·상실
       * 신고를 열고, 같으면 열린 신고를 닫습니다. 내용이 같은 열린 신고는 그대로 둡니다. 가족을 지울 때는 `wanted`가
       * `false`이고, 등록된 피부양자는 지울 수 없으므로 열린 취득 신고만 닫습니다.
       */
      const dependantFilingsOf = (member: FamilyMemberRecord) =>
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

      const syncDependantFiling = Effect.fn('FamilyMembers.syncDependantFiling')(function* (
        member: FamilyMemberRecord,
        wanted: boolean,
        at: string,
      ) {
        const source = { type: 'FAMILY_MEMBER', id: member.id } as const
        const own = yield* dependantFilingsOf(member)
        const change = dependantChange(wanted, own)
        const payload: InsuranceFilingPayloads['DEPENDANT'] | undefined =
          change === undefined
            ? undefined
            : {
                familyMemberId: member.id,
                change,
                name: member.name,
                relation: member.relation,
                birthDate: member.birthDate,
              }
        const open = own.filter((filing) => OPEN_STATUSES.includes(filing.status))
        if (payload === undefined ? open.length === 0 : open.some((filing) => samePayload(filing.payload, payload))) {
          return
        }
        yield* filings.withdraw(member.companyId, source, 'DEPENDANT', at)
        if (payload === undefined) return
        yield* filings.save(
          pendingFiling(
            { companyId: member.companyId, employeeId: member.employeeId },
            'DEPENDANT',
            source,
            payload,
            at,
          ),
        )
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
          if (employee.kind !== 'WAGE') return yield* new EmployeeKindNotSupported({ kind: employee.kind })
          const member: FamilyMemberRecord = {
            id: newId('familyMember'),
            companyId: actor.companyId,
            employeeId,
            ...(yield* resolve(input)),
            version: 1,
          }
          yield* members.save(member)
          yield* syncDependantFiling(member, member.healthInsuranceDependant, yield* nowIso)
          return toView(member)
        }),

        update: Effect.fn('FamilyMembers.update')(function* (actor, id, input, expectedVersion) {
          const current = yield* findMember(actor, id)
          yield* checkVersion(current.version, expectedVersion)
          const next: FamilyMemberRecord = {
            id: current.id,
            companyId: current.companyId,
            employeeId: current.employeeId,
            ...(yield* resolve(input)),
            version: current.version + 1,
          }
          yield* members.save(next)
          yield* syncDependantFiling(next, next.healthInsuranceDependant, yield* nowIso)
          return toView(next)
        }),

        remove: Effect.fn('FamilyMembers.remove')(function* (actor, id) {
          const member = yield* findMember(actor, id)
          if (isRegisteredDependant(yield* dependantFilingsOf(member))) {
            return yield* new FamilyMemberDependantRegistered({})
          }
          yield* members.remove(actor.companyId, member.id)
          yield* syncDependantFiling(member, false, yield* nowIso)
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
