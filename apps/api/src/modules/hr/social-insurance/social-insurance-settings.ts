import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { WorkContractRepository } from '../contracts/work-contract.ts'
import { contractInForce } from '../contracts/work-contract-period.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeKindNotSupported, EmployeeNotFound, type EmployeeRecord } from '../employees/employee.ts'
import { entryInEffect } from '../tax-withholding/tax-withholding-history.ts'
import { DEFAULT_ENROLLMENT, determineEligibility } from './insurance-eligibility.ts'
import type { EligibilityResult, Insurance, InsuranceEnrollment } from './insurance-eligibility.types.ts'
import { eligibilityMismatches } from './social-insurance-setting-rules.ts'
import { decideSocialInsuranceSettingSave } from './social-insurance-setting.aggregate.ts'
import {
  type SocialInsuranceSetting,
  type SocialInsuranceSettingEntry,
  type SocialInsuranceSettingInput,
  type SocialInsuranceSettingInvalid,
  SocialInsuranceSettingNotFound,
  type SocialInsuranceSettingRecord,
  SocialInsuranceSettingRepository,
} from './social-insurance-setting.ts'

/** 판정에서 저장하지 않은 값으로 바꿔 볼 근로 조건입니다. */
export interface EligibilityOverrides {
  weeklyWorkHours?: number
  isRepresentativeOrExecutive?: boolean
  isRepresentativeRelative?: boolean
}

type Enrollments = Record<Insurance, InsuranceEnrollment>

/**
 * 근로소득자의 4대보험 가입 설정과 자격 판정입니다. 설정은 소득세 공제처럼 `effectiveFrom` 이력으로 쌓고, 버전은 직원 한 명의
 * 이력 전체에 하나입니다.
 */
export class SocialInsuranceSettings extends Context.Service<
  SocialInsuranceSettings,
  {
    get(
      actor: Actor,
      employeeId: Id<'employee'>,
      asOf: string,
    ): Effect.Effect<SocialInsuranceSetting, EmployeeNotFound | SocialInsuranceSettingNotFound>
    put(
      actor: Actor,
      employeeId: Id<'employee'>,
      input: SocialInsuranceSettingInput,
      expectedVersion: number | undefined,
    ): Effect.Effect<
      SocialInsuranceSetting,
      EmployeeNotFound | EmployeeKindNotSupported | SocialInsuranceSettingInvalid | VersionMismatch
    >
    /**
     * 기준일의 자격 판정입니다. 본문이 비면 저장된 설정의 근로 조건과 가입 여부로 판정하고, 값을 주면 그 값으로 바꿔 봅니다.
     * 저장하지 않습니다.
     */
    determine(
      actor: Actor,
      employeeId: Id<'employee'>,
      overrides: EligibilityOverrides,
      asOf: string,
    ): Effect.Effect<EligibilityResult, EmployeeNotFound>
  }
>()('semu/hr/SocialInsuranceSettings') {
  static readonly layer = Layer.effect(
    SocialInsuranceSettings,
    Effect.gen(function* () {
      const settings = yield* SocialInsuranceSettingRepository
      const employees = yield* EmployeeRepository
      const workContracts = yield* WorkContractRepository

      const findEmployee = (actor: Actor, id: Id<'employee'>) =>
        employees
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new EmployeeNotFound({})), onSome: Effect.succeed }),
            ),
          )

      /** 판정합니다. 주 소정근로시간이 없으면 기준일의 근로계약에서 읽습니다. */
      const judge = (
        employee: EmployeeRecord,
        conditions: EligibilityOverrides,
        current: Readonly<Enrollments>,
        asOf: string,
      ) =>
        Effect.map(workContracts.list(employee.companyId), (all) => {
          const contract = contractInForce(
            all.filter((candidate) => candidate.employeeId === employee.id),
            asOf,
          )
          return determineEligibility(
            {
              birthDate: employee.birthDate,
              joinDate: employee.joinDate,
              isForeigner: employee.isForeigner,
              visaCode: employee.visaCode,
              nationalityCode: employee.nationalityCode,
              weeklyWorkHours: conditions.weeklyWorkHours ?? contract?.weeklyWorkHours,
              isRepresentativeOrExecutive: conditions.isRepresentativeOrExecutive ?? false,
              isRepresentativeRelative: conditions.isRepresentativeRelative ?? false,
            },
            current,
            asOf,
          )
        })

      const toView = Effect.fn('SocialInsuranceSettings.toView')(function* (
        employee: EmployeeRecord,
        record: SocialInsuranceSettingRecord,
        entry: SocialInsuranceSettingEntry,
        asOf: string,
      ) {
        // 경고는 사용자가 정한 값과 상관없는 판정과 비교합니다. 저장값을 출발점으로 두면 판정이 사용자의 제외를 그대로 물려받습니다.
        const { recommended } = yield* judge(employee, entry, DEFAULT_ENROLLMENT, asOf)
        const view: SocialInsuranceSetting = {
          employeeId: record.id,
          ...entry,
          recommended: {
            nps: stripUndefined(recommended.nps),
            nhis: stripUndefined(recommended.nhis),
            ei: stripUndefined(recommended.ei),
            iais: stripUndefined(recommended.iais),
          },
          warnings: eligibilityMismatches(entry, recommended).map((insurance) => ({
            code: 'ELIGIBILITY_MISMATCH' as const,
            insurance,
          })),
          version: record.version,
          updatedAt: record.updatedAt,
        }
        return view
      })

      const storedEntry = (companyId: Id<'company'>, employeeId: Id<'employee'>, asOf: string) =>
        Effect.map(settings.find(companyId, employeeId), (record) =>
          Option.flatMap(record, (found) =>
            Option.map(Option.fromNullishOr(entryInEffect(found.entries, asOf)), (entry) => ({ record: found, entry })),
          ),
        )

      return SocialInsuranceSettings.of({
        get: Effect.fn('SocialInsuranceSettings.get')(function* (actor, employeeId, asOf) {
          const employee = yield* findEmployee(actor, employeeId)
          const found = yield* storedEntry(actor.companyId, employeeId, asOf)
          if (Option.isNone(found)) return yield* new SocialInsuranceSettingNotFound({})
          return yield* toView(employee, found.value.record, found.value.entry, asOf)
        }),

        put: Effect.fn('SocialInsuranceSettings.put')(function* (actor, employeeId, input, expectedVersion) {
          const employee = yield* findEmployee(actor, employeeId)
          if (employee.kind !== 'WAGE') return yield* new EmployeeKindNotSupported({ kind: employee.kind })
          const current = yield* settings.find(actor.companyId, employeeId)
          yield* checkVersion(
            Option.match(current, { onNone: () => 0, onSome: (found) => found.version }),
            expectedVersion,
          )
          const { setting: record } = yield* Effect.fromResult(
            decideSocialInsuranceSettingSave(
              { companyId: actor.companyId, employeeId },
              Option.getOrUndefined(current),
              input,
              DateTime.formatIso(yield* DateTime.now),
            ),
          )
          yield* settings.save(record)
          return yield* toView(employee, record, input, input.effectiveFrom)
        }),

        determine: Effect.fn('SocialInsuranceSettings.determine')(function* (actor, employeeId, overrides, asOf) {
          const employee = yield* findEmployee(actor, employeeId)
          const found = yield* storedEntry(actor.companyId, employeeId, asOf)
          const stored = Option.getOrUndefined(found)?.entry
          const conditions: EligibilityOverrides = {
            ...(stored?.weeklyWorkHours === undefined ? {} : { weeklyWorkHours: stored.weeklyWorkHours }),
            isRepresentativeOrExecutive: stored?.isRepresentativeOrExecutive ?? false,
            isRepresentativeRelative: stored?.isRepresentativeRelative ?? false,
            ...overrides,
          }
          return yield* judge(employee, conditions, stored ?? DEFAULT_ENROLLMENT, asOf)
        }),
      })
    }),
  )
}
