import { Array as Arr, Context, DateTime, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { PayrollContractRepository } from '../contracts/payroll-contract.ts'
import { WorkContractRepository } from '../contracts/work-contract.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import {
  decideSignedDocumentIntake,
  decideSignedDocumentVoid,
  type CompletedEsignRequest,
  type SignedContracts,
} from './employee-document.aggregate.ts'
import { EmployeeDocumentRepository, type EmployeeDocumentRecord } from './employee-document.ts'

export type { CompletedEsignRequest } from './employee-document.aggregate.ts'

/**
 * 전자서명 결과를 인사 기록에 반영합니다. outbox가 최소 1회 넘기므로 같은 요청을 두 번 받아도 결과가 같습니다. 판정은
 * `employee-document.aggregate.ts`가 하고 여기서는 읽고 저장만 합니다(서명 문서 반영 묶음).
 *
 * - 완료: 완료본을 직원 문서 보관함에 넣고, 문서가 확정하는 근로·급여계약({@link signedContractLinks})에 서명 문서를 잇습니다.
 *   수신자가 직원이 아니면 아무것도 하지 않습니다. 직원이 지워졌으면 문서만 넣고 계약은 잇지 않습니다
 * - 무효가 완료보다 먼저 오면(완료 처리가 실패해 재전달될 때) 무효 표식을 남기고, 늦게 온 완료는 문서를 `VOIDED`로 넣고 잇지 않습니다
 * - 무효: 보관함 문서를 `VOIDED`로 두고, 아직 그 문서를 가리키는 계약에서 서명 문서를 풉니다. 예전 서명 문서로 되돌리지 않습니다.
 *   그 사이 계약이 바뀌었을 수 있어, 다시 서명받아야 확정으로 봅니다
 */
export class SignedDocumentIntake extends Context.Service<
  SignedDocumentIntake,
  {
    completed(request: CompletedEsignRequest): Effect.Effect<void>
    voided(companyId: Id<'company'>, esignRequestId: Id<'esignRequest'>, at: string): Effect.Effect<void>
  }
>()('semu/hr/SignedDocumentIntake') {
  static readonly layer = Layer.effect(
    SignedDocumentIntake,
    Effect.gen(function* () {
      const documents = yield* EmployeeDocumentRepository
      const employees = yield* EmployeeRepository
      const workContracts = yield* WorkContractRepository
      const payrollContracts = yield* PayrollContractRepository

      /** 판정이 돌려준 문서와 계약을 저장합니다. */
      const save = Effect.fn('SignedDocumentIntake.save')(function* (
        decision: { document: EmployeeDocumentRecord } & SignedContracts,
      ) {
        yield* documents.save(decision.document)
        yield* Effect.forEach(decision.workContracts, workContracts.save, { discard: true })
        yield* Effect.forEach(decision.payrollContracts, payrollContracts.save, { discard: true })
      })

      const now = DateTime.now.pipe(Effect.map(DateTime.formatIso))

      return SignedDocumentIntake.of({
        completed: Effect.fn('SignedDocumentIntake.completed')(function* (request) {
          if (request.employeeId === undefined) return
          const employeeId = request.employeeId
          const alreadyFiled = Option.isSome(
            yield* documents.findByEsignRequest(request.companyId, request.esignRequestId),
          )
          if (alreadyFiled) return
          const employee = Option.getOrUndefined(yield* employees.find(request.companyId, employeeId))
          const own = <T extends { employeeId: Id<'employee'> }>(records: ReadonlyArray<T>) =>
            records.filter((record) => record.employeeId === employeeId)
          // 직원이 지워졌으면 이을 계약을 찾지 않습니다.
          const decision = decideSignedDocumentIntake(
            request,
            newId('document'),
            {
              alreadyFiled,
              voidedAt: Option.getOrUndefined(yield* documents.voidedAt(request.companyId, request.esignRequestId)),
              employee,
              workContracts: employee === undefined ? [] : own(yield* workContracts.list(request.companyId)),
              payrollContracts: employee === undefined ? [] : own(yield* payrollContracts.list(request.companyId)),
            },
            yield* now,
          )
          if (decision !== undefined) yield* save(decision)
        }),

        voided: Effect.fn('SignedDocumentIntake.voided')(function* (companyId, esignRequestId, at) {
          const found = yield* documents.findByEsignRequest(companyId, esignRequestId)
          if (Option.isNone(found)) return yield* documents.markVoided(companyId, esignRequestId, at)
          // 연결된 계약만 ID로 읽습니다. 지워진 계약은 건너뜁니다.
          const links = found.value.links
          const work = yield* Effect.forEach(
            links.flatMap((link) => (link.type === 'WORK_CONTRACT' ? [link.id] : [])),
            (id) => workContracts.find(companyId, id),
          )
          const payroll = yield* Effect.forEach(
            links.flatMap((link) => (link.type === 'PAYROLL_CONTRACT' ? [link.id] : [])),
            (id) => payrollContracts.find(companyId, id),
          )
          const decision = decideSignedDocumentVoid(
            found.value,
            {
              workContracts: Arr.getSomes(work),
              payrollContracts: Arr.getSomes(payroll),
            },
            at,
            yield* now,
          )
          if (decision !== undefined) yield* save(decision)
        }),
      })
    }),
  )
}
