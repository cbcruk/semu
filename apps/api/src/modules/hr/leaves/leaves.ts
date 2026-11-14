import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { cannotFail, checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import { InsuranceFilingRepository, pendingFiling } from '../insurance-filings/insurance-filing-repository.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import {
  decideLeaveCreation,
  decideLeaveRemoval,
  decideLeaveReturn,
  type LeaveFilingChange,
} from './leave.aggregate.ts'
import { summarizeLeaves } from './leave-rules.ts'
import type { LeaveSummary } from './leave-rules.types.ts'
import {
  LeaveNotFound,
  LeaveRepository,
  type LeaveInvalid,
  type LeaveOverlap,
  type CreateLeave,
  type Leave,
  type LeaveRecord,
} from './leave.ts'

/** 휴직 관리입니다. 등록·복직 때 4대보험 휴직/복직 신고를 대기열에 넣습니다. */
export class Leaves extends Context.Service<
  Leaves,
  {
    list(
      actor: Actor,
      employeeId: Id<'employee'>,
    ): Effect.Effect<{ items: Leave[]; summary: LeaveSummary }, EmployeeNotFound>
    create(
      actor: Actor,
      employeeId: Id<'employee'>,
      input: typeof CreateLeave.Type,
    ): Effect.Effect<Leave, EmployeeNotFound | LeaveInvalid | LeaveOverlap>
    returnFromLeave(
      actor: Actor,
      leaveId: Id<'leave'>,
      actualReturnDate: string,
      expectedVersion: number | undefined,
    ): Effect.Effect<Leave, LeaveNotFound | LeaveInvalid | VersionMismatch>
    remove(actor: Actor, leaveId: Id<'leave'>): Effect.Effect<void, LeaveNotFound>
  }
>()('semu/hr/Leaves') {
  static readonly layer = Layer.effect(
    Leaves,
    Effect.gen(function* () {
      const leaves = yield* LeaveRepository
      const employees = yield* EmployeeRepository
      const filings = yield* InsuranceFilingRepository

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

      const findLeave = (actor: Actor, id: Id<'leave'>) =>
        leaves
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(Option.match({ onNone: () => Effect.fail(new LeaveNotFound({})), onSome: Effect.succeed })),
          )

      const leavesOf = (actor: Actor, employeeId: Id<'employee'>) =>
        leaves.list(actor.companyId).pipe(Effect.map((all) => all.filter((leave) => leave.employeeId === employeeId)))

      const toView = ({ companyId: _, ...leave }: LeaveRecord): Leave => stripUndefined(leave)

      /** 판정이 알려 준 신고 변경을 그 순서대로 합니다. */
      const applyFilings = (leave: LeaveRecord, changes: ReadonlyArray<LeaveFilingChange>) =>
        Effect.gen(function* () {
          if (changes.length === 0) return
          const at = yield* nowIso
          const source = { type: 'LEAVE' as const, id: leave.id }
          const owner = { companyId: leave.companyId, employeeId: leave.employeeId }
          for (const change of changes) {
            if (change.action === 'WITHDRAW') yield* filings.withdraw(leave.companyId, source, change.kind, at)
            else if (change.kind === 'LEAVE')
              yield* filings.save(pendingFiling(owner, 'LEAVE', source, change.payload, at))
            else yield* filings.save(pendingFiling(owner, 'RETURN', source, change.payload, at))
          }
        })

      return Leaves.of({
        list: Effect.fn('Leaves.list')(function* (actor, employeeId) {
          yield* findEmployee(actor, employeeId)
          const own = yield* leavesOf(actor, employeeId)
          return { items: own.map(toView), summary: summarizeLeaves(own, yield* today) }
        }),

        create: Effect.fn('Leaves.create')(function* (actor, employeeId, input) {
          const employee = yield* findEmployee(actor, employeeId)
          const decision = yield* Effect.fromResult(
            decideLeaveCreation(
              { id: newId('leave'), companyId: actor.companyId, employeeId, terms: input },
              { employee, otherLeaves: yield* leavesOf(actor, employeeId) },
            ),
          )
          yield* leaves.save(decision.leave)
          yield* applyFilings(decision.leave, decision.filings)
          return toView(decision.leave)
        }),

        returnFromLeave: Effect.fn('Leaves.returnFromLeave')(
          function* (actor, leaveId, actualReturnDate, expectedVersion) {
            const leave = yield* findLeave(actor, leaveId)
            yield* checkVersion(leave.version, expectedVersion)
            const employee = Option.getOrUndefined(yield* employees.find(actor.companyId, leave.employeeId))
            const others = (yield* leavesOf(actor, leave.employeeId)).filter((other) => other.id !== leave.id)
            const decision = yield* Effect.fromResult(
              decideLeaveReturn(leave, actualReturnDate, { employee, otherLeaves: others }),
            ).pipe(cannotFail('LeaveOverlap'))
            yield* leaves.save(decision.leave)
            yield* applyFilings(decision.leave, decision.filings)
            return toView(decision.leave)
          },
        ),

        remove: Effect.fn('Leaves.remove')(function* (actor, leaveId) {
          const leave = yield* findLeave(actor, leaveId)
          yield* leaves.remove(actor.companyId, leave.id)
          yield* applyFilings(leave, decideLeaveRemoval().filings)
        }),
      })
    }),
  )
}
