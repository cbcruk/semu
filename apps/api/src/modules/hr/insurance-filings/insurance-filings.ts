import { Context, DateTime, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { applyInsuranceFilingCommand } from './insurance-filing-rules.ts'
import { InsuranceFilingRepository } from './insurance-filing-repository.ts'
import {
  InsuranceFilingNotFound,
  InsuranceFilingTransitionInvalid,
  type InsuranceFilingView,
} from './insurance-filing.ts'
import type {
  InsuranceFiling,
  InsuranceFilingCommand,
  InsuranceFilingKind,
  InsuranceFilingStatus,
} from './insurance-filing.types.ts'

/** 신고 목록 조건입니다. 비우면 모두입니다. */
export interface InsuranceFilingFilter {
  status?: InsuranceFilingStatus
  employeeId?: Id<'employee'>
  kind?: InsuranceFilingKind
}

/**
 * 4대보험 신고 큐입니다. 직원 등록·퇴직·휴직·복직·보수 변경이 `PENDING` 신고를 만들고, 세무 대리인이 완료·실패로 처리합니다.
 * 자동 EDI는 범위 밖이라 대리인이 공단에 신고한 결과를 기록합니다.
 */
export class InsuranceFilings extends Context.Service<
  InsuranceFilings,
  {
    /** 요청 순서(오래된 것부터)입니다. 처리할 일을 앞에서부터 보는 큐라서입니다. */
    list(actor: Actor, filter: InsuranceFilingFilter): Effect.Effect<InsuranceFilingView[]>
    get(actor: Actor, id: Id<'insuranceFiling'>): Effect.Effect<InsuranceFilingView, InsuranceFilingNotFound>
    process(
      actor: Actor,
      id: Id<'insuranceFiling'>,
      command: InsuranceFilingCommand,
    ): Effect.Effect<InsuranceFilingView, InsuranceFilingNotFound | InsuranceFilingTransitionInvalid>
  }
>()('semu/hr/InsuranceFilings') {
  static readonly layer = Layer.effect(
    InsuranceFilings,
    Effect.gen(function* () {
      const filings = yield* InsuranceFilingRepository
      const employees = yield* EmployeeRepository

      const namesOf = (companyId: Id<'company'>) =>
        Effect.map(
          employees.list(companyId),
          (all) => new Map<string, string>(all.map((employee) => [employee.id, employee.name])),
        )

      const toView = (filing: InsuranceFiling, names: ReadonlyMap<string, string>): InsuranceFilingView => {
        const { companyId: _, ...rest } = filing
        return { ...rest, employeeName: names.get(filing.employeeId) ?? '' } as InsuranceFilingView
      }

      const find = (actor: Actor, id: Id<'insuranceFiling'>) =>
        Effect.flatMap(
          filings.find(actor.companyId, id),
          Option.match({ onNone: () => Effect.fail(new InsuranceFilingNotFound({})), onSome: Effect.succeed }),
        )

      return InsuranceFilings.of({
        list: Effect.fn('InsuranceFilings.list')(function* (actor, filter) {
          const [all, names] = yield* Effect.all([filings.list(actor.companyId), namesOf(actor.companyId)])
          return all
            .filter(
              (filing) =>
                (filter.status === undefined || filing.status === filter.status) &&
                (filter.employeeId === undefined || filing.employeeId === filter.employeeId) &&
                (filter.kind === undefined || filing.kind === filter.kind),
            )
            .toSorted((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id))
            .map((filing) => toView(filing, names))
        }),

        get: Effect.fn('InsuranceFilings.get')(function* (actor, id) {
          const filing = yield* find(actor, id)
          return toView(filing, yield* namesOf(actor.companyId))
        }),

        process: Effect.fn('InsuranceFilings.process')(function* (actor, id, command) {
          const filing = yield* find(actor, id)
          const next = applyInsuranceFilingCommand(filing, command, DateTime.formatIso(yield* DateTime.now))
          if (next === undefined) return yield* new InsuranceFilingTransitionInvalid({ currentStatus: filing.status })
          yield* filings.save(next)
          return toView(next, yield* namesOf(actor.companyId))
        }),
      })
    }),
  )
}
