import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { PayrollContractRepository } from '../contracts/payroll-contract.ts'
import { WorkContractRepository } from '../contracts/work-contract.ts'
import { decidePayrollContractSigning } from '../contracts/payroll-contract.aggregate.ts'
import { decideWorkContractSigning } from '../contracts/work-contract.aggregate.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { documentCategoryOf, signedContractLinks } from './employee-document-rules.ts'
import { EmployeeDocumentRepository, type EmployeeDocumentRecord } from './employee-document.ts'
import type { EmployeeDocumentLink, SignedDocumentPart } from './employee-document.types.ts'

/** 서명이 끝난 전자서명 요청입니다. Documents의 `esign_request.completed`에서 옵니다. */
export interface CompletedEsignRequest {
  companyId: Id<'company'>
  esignRequestId: Id<'esignRequest'>
  /** 수신자가 직원이 아니면 없습니다. */
  employeeId?: Id<'employee'> | undefined
  title: string
  fileId: Id<'file'>
  signedAt: string
  documents: ReadonlyArray<SignedDocumentPart>
}

/**
 * 전자서명 결과를 인사 기록에 반영합니다. outbox가 최소 1회 넘기므로 같은 요청을 두 번 받아도 결과가 같습니다.
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

      /**
       * 계약 하나의 서명 문서를 바꿉니다. `from`을 주면 지금 그 문서를 가리킬 때만 바꿉니다(무효로 풀 때, 그 사이 다시 서명했거나
       * 고친 계약은 그대로 둡니다). 지워진 계약은 건너뜁니다.
       */
      const setSignedDocument = Effect.fn('SignedDocumentIntake.setSignedDocument')(function* (
        companyId: Id<'company'>,
        link: EmployeeDocumentLink,
        to: Id<'document'> | undefined,
        from?: Id<'document'>,
      ) {
        if (link.type === 'WORK_CONTRACT') {
          const found = yield* workContracts.find(companyId, link.id)
          const decision = Option.isSome(found) ? decideWorkContractSigning(found.value, to, from) : undefined
          if (decision !== undefined) yield* workContracts.save(decision.workContract)
        } else {
          const found = yield* payrollContracts.find(companyId, link.id)
          const at = DateTime.formatIso(yield* DateTime.now)
          const decision = Option.isSome(found) ? decidePayrollContractSigning(found.value, to, at, from) : undefined
          if (decision !== undefined) yield* payrollContracts.save(decision.payrollContract)
        }
      })

      return SignedDocumentIntake.of({
        completed: Effect.fn('SignedDocumentIntake.completed')(function* (request) {
          if (request.employeeId === undefined) return
          const employeeId = request.employeeId
          if (Option.isSome(yield* documents.findByEsignRequest(request.companyId, request.esignRequestId))) return
          const voidedAt = Option.getOrUndefined(yield* documents.voidedAt(request.companyId, request.esignRequestId))
          const employee = Option.getOrUndefined(yield* employees.find(request.companyId, employeeId))
          const own = <T extends { employeeId: Id<'employee'> }>(records: ReadonlyArray<T>) =>
            records.filter((record) => record.employeeId === employeeId)
          // 직원이 지워졌어도 완료본은 남기고, 이을 계약만 찾지 않습니다.
          const links =
            employee === undefined
              ? []
              : signedContractLinks(request.documents, {
                  joinDate: employee.joinDate,
                  workContracts: own(yield* workContracts.list(request.companyId)),
                  payrollContracts: own(yield* payrollContracts.list(request.companyId)),
                })
          const record: EmployeeDocumentRecord = {
            id: newId('document'),
            companyId: request.companyId,
            employeeId,
            category: documentCategoryOf(request.documents.map((document) => document.kind)),
            origin: 'ESIGN',
            title: request.title,
            fileId: request.fileId,
            // 서명 완료본은 Documents가 `<제목>.pdf`로 저장합니다(`PdfRenderer`).
            fileName: `${request.title}.pdf`,
            contentType: 'application/pdf',
            esignRequestId: request.esignRequestId,
            signedAt: request.signedAt,
            createdAt: DateTime.formatIso(yield* DateTime.now),
            status: voidedAt === undefined ? 'ACTIVE' : 'VOIDED',
            voidedAt,
            links,
          }
          yield* documents.save(record)
          // 먼저 무효가 왔으면 문서만 무효로 넣고 계약은 잇지 않습니다.
          if (voidedAt !== undefined) return
          yield* Effect.forEach(links, (link) => setSignedDocument(request.companyId, link, record.id), {
            discard: true,
          })
        }),

        voided: Effect.fn('SignedDocumentIntake.voided')(function* (companyId, esignRequestId, at) {
          const found = yield* documents.findByEsignRequest(companyId, esignRequestId)
          if (Option.isNone(found)) return yield* documents.markVoided(companyId, esignRequestId, at)
          if (found.value.status === 'VOIDED') return
          const voided: EmployeeDocumentRecord = { ...found.value, status: 'VOIDED', voidedAt: at }
          yield* documents.save(voided)
          yield* Effect.forEach(voided.links, (link) => setSignedDocument(companyId, link, undefined, voided.id), {
            discard: true,
          })
        }),
      })
    }),
  )
}
