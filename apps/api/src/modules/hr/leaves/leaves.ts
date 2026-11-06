import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { cannotFail, checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeNotFound, type EmployeeRecord } from '../employees/employee.ts'
import { InsuranceFilingRepository } from '../insurance-filings/insurance-filing-repository.ts'
import type { InsuranceFilingKind } from '../insurance-filings/insurance-filing.types.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import { summarizeLeaves, validateLeave } from './leave-rules.ts'
import type { LeaveSummary, LeaveTerms, LeaveValidation } from './leave-rules.types.ts'
import {
  LeaveInvalid,
  LeaveNotFound,
  LeaveOverlap,
  LeaveRepository,
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

      const check = (
        record: EmployeeRecord | undefined,
        terms: LeaveTerms,
        others: ReadonlyArray<LeaveRecord>,
      ): Effect.Effect<LeaveValidation['normalized'], LeaveInvalid | LeaveOverlap> => {
        const result = validateLeave(terms, {
          joinDate: record?.joinDate,
          leaveDate: record?.resignation?.leaveDate,
          otherLeaves: others,
        })
        if (result.violations.length > 0) return Effect.fail(new LeaveInvalid({ violations: result.violations }))
        if (result.overlappingLeaveId !== undefined) {
          return Effect.fail(new LeaveOverlap({ overlappingLeaveId: result.overlappingLeaveId as Id<'leave'> }))
        }
        return Effect.succeed(result.normalized)
      }

      const queueFiling = (leave: LeaveRecord, kind: InsuranceFilingKind, at: string) =>
        filings.save({
          id: newId('insuranceFiling'),
          companyId: leave.companyId,
          employeeId: leave.employeeId,
          kind,
          source: { type: 'LEAVE', id: leave.id },
          payload: { startDate: leave.startDate, endDate: leave.endDate },
          status: 'PENDING',
          requestedAt: at,
        })

      return Leaves.of({
        list: Effect.fn('Leaves.list')(function* (actor, employeeId) {
          yield* findEmployee(actor, employeeId)
          const own = yield* leavesOf(actor, employeeId)
          return { items: own.map(toView), summary: summarizeLeaves(own, yield* today) }
        }),

        create: Effect.fn('Leaves.create')(function* (actor, employeeId, input) {
          const employee = yield* findEmployee(actor, employeeId)
          const normalized = yield* check(employee, input, yield* leavesOf(actor, employeeId))
          const now = yield* nowIso
          const leave: LeaveRecord = {
            id: newId('leave'),
            companyId: actor.companyId,
            employeeId,
            reason: input.reason,
            startDate: input.startDate,
            endDate: input.endDate,
            expectedReturnDate: normalized.expectedReturnDate,
            paidAllowance: input.paid?.allowance,
            includeInServiceYears: normalized.includeInServiceYears,
            npsPaymentException: input.npsPaymentException ?? false,
            nhisNoticeDeferral: input.nhisNoticeDeferral ?? false,
            version: 1,
          }
          yield* leaves.save(leave)
          if (employee.kind === 'WAGE') yield* queueFiling(leave, 'LEAVE', now)
          return toView(leave)
        }),

        returnFromLeave: Effect.fn('Leaves.returnFromLeave')(
          function* (actor, leaveId, actualReturnDate, expectedVersion) {
            const leave = yield* findLeave(actor, leaveId)
            yield* checkVersion(leave.version, expectedVersion)
            const employee = Option.getOrUndefined(yield* employees.find(actor.companyId, leave.employeeId))
            const others = (yield* leavesOf(actor, leave.employeeId)).filter((other) => other.id !== leave.id)
            const terms: LeaveTerms = {
              ...leave,
              actualReturnDate,
              ...(leave.paidAllowance === undefined ? {} : { paid: { allowance: leave.paidAllowance } }),
            }
            yield* check(employee, terms, others).pipe(cannotFail('LeaveOverlap'))
            const next: LeaveRecord = { ...leave, actualReturnDate, version: leave.version + 1 }
            yield* leaves.save(next)
            if (employee?.kind === 'WAGE') yield* queueFiling(next, 'RETURN', yield* nowIso)
            return toView(next)
          },
        ),

        remove: Effect.fn('Leaves.remove')(function* (actor, leaveId) {
          const leave = yield* findLeave(actor, leaveId)
          yield* leaves.remove(actor.companyId, leave.id)
          // 휴직 신고와 복직 신고를 함께 닫습니다. 없는 휴직의 복직 신고가 남지 않게 합니다(현행 `removeLeave`와 같음).
          const at = yield* nowIso
          yield* filings.withdraw(actor.companyId, { type: 'LEAVE', id: leave.id }, 'LEAVE', at)
          yield* filings.withdraw(actor.companyId, { type: 'LEAVE', id: leave.id }, 'RETURN', at)
        }),
      })
    }),
  )
}
