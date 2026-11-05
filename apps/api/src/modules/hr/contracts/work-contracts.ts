import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import { stripUndefined } from '../shared/tenant-table.ts'
import { indefiniteConversion } from './indefinite-conversion.ts'
import type { IndefiniteConversion } from './indefinite-conversion.types.ts'
import { workContractStatus } from './work-contract-period.ts'
import { validateWorkContract } from './work-contract-validation.ts'
import {
  WorkContractInvalid,
  WorkContractRepository,
  type WorkContract,
  type WorkContractInput,
  type WorkContractRecord,
} from './work-contract.ts'

/** 근로계약 관리와 무기계약 전환 판정입니다. */
export class WorkContracts extends Context.Service<
  WorkContracts,
  {
    list(actor: Actor, employeeId: Id<'employee'>): Effect.Effect<WorkContract[], EmployeeNotFound>
    create(
      actor: Actor,
      employeeId: Id<'employee'>,
      input: typeof WorkContractInput.Type,
    ): Effect.Effect<WorkContract, EmployeeNotFound | WorkContractInvalid>
    indefiniteConversion(
      actor: Actor,
      employeeId: Id<'employee'>,
    ): Effect.Effect<IndefiniteConversion, EmployeeNotFound>
  }
>()('semu/hr/WorkContracts') {
  static readonly layer = Layer.effect(
    WorkContracts,
    Effect.gen(function* () {
      const contracts = yield* WorkContractRepository
      const employees = yield* EmployeeRepository
      const today = DateTime.now.pipe(Effect.map((now) => companyDate(DateTime.toEpochMillis(now))))

      const findEmployee = (actor: Actor, id: Id<'employee'>) =>
        employees
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new EmployeeNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const contractsOf = (actor: Actor, employeeId: Id<'employee'>) =>
        contracts.list(actor.companyId).pipe(Effect.map((all) => all.filter((c) => c.employeeId === employeeId)))

      const toView = ({ companyId: _, ...contract }: WorkContractRecord, asOf: string): WorkContract => ({
        ...stripUndefined(contract),
        status: workContractStatus(contract, asOf),
      })

      return WorkContracts.of({
        list: Effect.fn('WorkContracts.list')(function* (actor, employeeId) {
          yield* findEmployee(actor, employeeId)
          const asOf = yield* today
          return (yield* contractsOf(actor, employeeId)).map((contract) => toView(contract, asOf))
        }),

        create: Effect.fn('WorkContracts.create')(function* (actor, employeeId, input) {
          yield* findEmployee(actor, employeeId)
          const violations = validateWorkContract(input)
          if (violations.length > 0) return yield* new WorkContractInvalid({ violations })
          const record: WorkContractRecord = {
            id: newId('workContract'),
            companyId: actor.companyId,
            employeeId,
            ...input,
            createdAt: DateTime.formatIso(yield* DateTime.now),
          }
          yield* contracts.save(record)
          return toView(record, yield* today)
        }),

        indefiniteConversion: Effect.fn('WorkContracts.indefiniteConversion')(function* (actor, employeeId) {
          const employee = yield* findEmployee(actor, employeeId)
          return indefiniteConversion(yield* contractsOf(actor, employeeId), employee.birthDate, yield* today)
        }),
      })
    }),
  )
}
