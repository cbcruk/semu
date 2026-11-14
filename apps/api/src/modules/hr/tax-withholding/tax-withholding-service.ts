import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeKindNotSupported, EmployeeNotFound } from '../employees/employee.ts'
import { countDependants } from '../family/dependant-rules.ts'
import { FamilyMemberRepository } from '../family/family-member.ts'
import type { DependantCounts } from '../family/family-member.types.ts'
import { entryInEffect } from './tax-withholding-history.ts'
import { decideTaxWithholdingSave } from './tax-withholding.aggregate.ts'
import {
  type TaxWithholdingInvalid,
  TaxWithholdingNotFound,
  TaxWithholdingRepository,
  type TaxWithholding,
  type TaxWithholdingEntry,
  type TaxWithholdingInput,
  type TaxWithholdingRecord,
} from './tax-withholding.ts'

/**
 * 근로소득자의 소득세 공제 설정(간이세액표 입력, 조정비율, 직접 입력 세액, 감면, 학자금 상환)입니다.
 *
 * 설정은 `effectiveFrom` 이력으로 쌓고, 조회는 기준일에 적용되는 항목을 돌려줍니다. 버전은 직원 한 명의 이력 전체에 하나입니다.
 * 공제대상 가족 수(본인 포함)와 8–20세 자녀 수는 입력받지 않고 기준일의 인적공제 대상자에서 셉니다.
 */
export class TaxWithholdingSettings extends Context.Service<
  TaxWithholdingSettings,
  {
    get(
      actor: Actor,
      employeeId: Id<'employee'>,
      asOf: string,
    ): Effect.Effect<TaxWithholding, EmployeeNotFound | TaxWithholdingNotFound>
    put(
      actor: Actor,
      employeeId: Id<'employee'>,
      input: TaxWithholdingInput,
      expectedVersion: number | undefined,
    ): Effect.Effect<
      TaxWithholding,
      EmployeeNotFound | EmployeeKindNotSupported | TaxWithholdingInvalid | VersionMismatch
    >
  }
>()('semu/hr/TaxWithholdingSettings') {
  static readonly layer = Layer.effect(
    TaxWithholdingSettings,
    Effect.gen(function* () {
      const settings = yield* TaxWithholdingRepository
      const employees = yield* EmployeeRepository
      const family = yield* FamilyMemberRepository

      const countsOn = (companyId: Id<'company'>, employeeId: Id<'employee'>, asOf: string) =>
        family.list(companyId).pipe(
          Effect.map((all) =>
            countDependants(
              all.filter((member) => member.employeeId === employeeId),
              asOf,
            ),
          ),
        )

      const findEmployee = (actor: Actor, id: Id<'employee'>) =>
        employees
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new EmployeeNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const toView = (
        record: TaxWithholdingRecord,
        entry: TaxWithholdingEntry,
        counts: DependantCounts,
      ): TaxWithholding => ({
        employeeId: record.id,
        ...entry,
        ...counts,
        version: record.version,
        updatedAt: record.updatedAt,
      })

      return TaxWithholdingSettings.of({
        get: Effect.fn('TaxWithholdingSettings.get')(function* (actor, employeeId, asOf) {
          yield* findEmployee(actor, employeeId)
          const record = yield* settings.find(actor.companyId, employeeId)
          const entry = Option.flatMap(record, (found) => Option.fromNullishOr(entryInEffect(found.entries, asOf)))
          if (Option.isNone(record) || Option.isNone(entry)) return yield* new TaxWithholdingNotFound({})
          return toView(record.value, entry.value, yield* countsOn(actor.companyId, employeeId, asOf))
        }),

        put: Effect.fn('TaxWithholdingSettings.put')(function* (actor, employeeId, input, expectedVersion) {
          const employee = yield* findEmployee(actor, employeeId)
          if (employee.kind !== 'WAGE') return yield* new EmployeeKindNotSupported({ kind: employee.kind })
          const current = yield* settings.find(actor.companyId, employeeId)
          yield* checkVersion(
            Option.match(current, { onNone: () => 0, onSome: (found) => found.version }),
            expectedVersion,
          )

          const { setting: record, entry } = yield* Effect.fromResult(
            decideTaxWithholdingSave(
              { companyId: actor.companyId, employeeId },
              Option.getOrUndefined(current),
              input,
              DateTime.formatIso(yield* DateTime.now),
            ),
          )
          yield* settings.save(record)
          return toView(record, entry, yield* countsOn(actor.companyId, employeeId, entry.effectiveFrom))
        }),
      })
    }),
  )
}
