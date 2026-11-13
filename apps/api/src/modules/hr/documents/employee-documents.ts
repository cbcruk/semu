import { Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import {
  EmployeeDocumentNotFound,
  EmployeeDocumentRepository,
  type EmployeeDocument,
  type EmployeeDocumentRecord,
} from './employee-document.ts'
import type { EmployeeDocumentCategory } from './employee-document.types.ts'

/** 직원 문서 보관함 조회입니다. 문서는 전자서명 완료 이벤트로만 들어옵니다({@link SignedDocumentIntake}). */
export class EmployeeDocuments extends Context.Service<
  EmployeeDocuments,
  {
    /** 서명 시각이 늦은 것부터입니다. */
    list(
      actor: Actor,
      employeeId: Id<'employee'>,
      category?: EmployeeDocumentCategory,
    ): Effect.Effect<EmployeeDocument[], EmployeeNotFound>
    get(actor: Actor, id: Id<'document'>): Effect.Effect<EmployeeDocument, EmployeeDocumentNotFound>
  }
>()('semu/hr/EmployeeDocuments') {
  static readonly layer = Layer.effect(
    EmployeeDocuments,
    Effect.gen(function* () {
      const documents = yield* EmployeeDocumentRepository
      const employees = yield* EmployeeRepository

      const toView = ({ companyId: _, links, ...rest }: EmployeeDocumentRecord): EmployeeDocument => ({
        ...stripUndefined(rest),
        links: [...links],
      })

      return EmployeeDocuments.of({
        list: Effect.fn('EmployeeDocuments.list')(function* (actor, employeeId, category) {
          if (Option.isNone(yield* employees.find(actor.companyId, employeeId))) return yield* new EmployeeNotFound({})
          return (yield* documents.list(actor.companyId))
            .filter(
              (document) =>
                document.employeeId === employeeId && (category === undefined || document.category === category),
            )
            .toSorted((a, b) => b.signedAt.localeCompare(a.signedAt))
            .map(toView)
        }),

        get: Effect.fn('EmployeeDocuments.get')(function* (actor, id) {
          const found = yield* documents.find(actor.companyId, id)
          if (Option.isNone(found)) return yield* new EmployeeDocumentNotFound({})
          return toView(found.value)
        }),
      })
    }),
  )
}
