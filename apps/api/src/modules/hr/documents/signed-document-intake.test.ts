import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { testActor } from '../../identity-access/testing.ts'
import { PayrollContractRepository } from '../contracts/payroll-contract.ts'
import { WorkContractRepository } from '../contracts/work-contract.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeDocumentRepository } from './employee-document.ts'
import { SignedDocumentIntake, type CompletedEsignRequest } from './signed-document-intake.ts'

const companyId = testActor().companyId
const employeeId = 'emp_01JBQ0000000000000000SIGN1' as Id<'employee'>
const workContractId = 'wct_01JBQ0000000000000000SIGN1' as Id<'workContract'>
const at = '2026-03-01T09:00:00.000Z'

const employee = {
  id: employeeId,
  companyId,
  kind: 'WAGE' as const,
  name: '김서명',
  joinDate: '2026-03-02',
  isRejoin: false,
  isForeigner: false,
  version: 1,
  createdAt: at,
  updatedAt: at,
}

const layerWith = (employees: ReadonlyArray<typeof employee>) =>
  SignedDocumentIntake.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        EmployeeDocumentRepository.layerMemory(),
        EmployeeRepository.layerMemory(employees),
        WorkContractRepository.layerMemory([
          {
            id: workContractId,
            companyId,
            employeeId,
            contractType: 'PERMANENT',
            startDate: '2026-03-02',
            createdAt: at,
          },
        ]),
        PayrollContractRepository.layerMemory(),
      ),
    ),
  )

const request = (n: number): CompletedEsignRequest => ({
  companyId,
  esignRequestId: `esr_01JBQ0000000000000000SIGN${n}` as Id<'esignRequest'>,
  employeeId,
  title: '근로계약',
  fileId: `fle_01JBQ0000000000000000SIGN${n}` as Id<'file'>,
  signedAt: `2026-03-0${n}T09:00:00.000Z`,
  documents: [{ kind: 'EMPLOYMENT_CONTRACT', title: '근로계약서', terms: {} }],
})

/** 이벤트를 차례로 넣고 보관함 문서와 근로계약의 서명 문서를 돌려줍니다. */
const run = (steps: (intake: SignedDocumentIntake['Service']) => Effect.Effect<void>, employees = [employee]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* steps(yield* SignedDocumentIntake)
      const documents = yield* (yield* EmployeeDocumentRepository).list(companyId)
      const contracts = yield* (yield* WorkContractRepository).list(companyId)
      return { documents, signedDocumentId: contracts[0]?.signedDocumentId }
    }).pipe(Effect.provide(layerWith(employees))),
  )

describe('전자서명 결과 반영(SignedDocumentIntake)', () => {
  it('같은 완료를 두 번 받아도 문서는 하나이고 연결도 같습니다', async () => {
    const result = await run((intake) => Effect.andThen(intake.completed(request(1)), intake.completed(request(1))))
    expect(result.documents).toHaveLength(1)
    expect(result.signedDocumentId).toBe(result.documents[0]!.id)
  })

  it('같은 무효를 두 번 받아도 처음 무효 시각을 지킵니다', async () => {
    const result = await run((intake) =>
      Effect.gen(function* () {
        yield* intake.completed(request(1))
        yield* intake.voided(companyId, request(1).esignRequestId, '2026-03-05T00:00:00.000Z')
        yield* intake.voided(companyId, request(1).esignRequestId, '2026-03-06T00:00:00.000Z')
      }),
    )
    expect(result.documents).toMatchObject([{ status: 'VOIDED', voidedAt: '2026-03-05T00:00:00.000Z' }])
    expect(result.signedDocumentId).toBeUndefined()
  })

  it('무효가 완료보다 먼저 오면 문서를 무효로 넣고 계약은 잇지 않습니다', async () => {
    const result = await run((intake) =>
      Effect.andThen(
        intake.voided(companyId, request(1).esignRequestId, '2026-03-05T00:00:00.000Z'),
        intake.completed(request(1)),
      ),
    )
    expect(result.documents).toMatchObject([
      {
        status: 'VOIDED',
        voidedAt: '2026-03-05T00:00:00.000Z',
        links: [{ type: 'WORK_CONTRACT', id: workContractId }],
      },
    ])
    expect(result.signedDocumentId).toBeUndefined()
  })

  it('먼저 온 무효는 다른 요청의 완료에 영향을 주지 않습니다', async () => {
    const result = await run((intake) =>
      Effect.andThen(intake.voided(companyId, request(1).esignRequestId, at), intake.completed(request(2))),
    )
    expect(result.documents).toMatchObject([{ status: 'ACTIVE' }])
    expect(result.signedDocumentId).toBe(result.documents[0]!.id)
  })

  it('직원이 지워졌어도 완료본은 남기고 계약은 잇지 않습니다', async () => {
    const result = await run((intake) => intake.completed(request(1)), [])
    expect(result.documents).toMatchObject([{ employeeId, status: 'ACTIVE', links: [] }])
    expect(result.signedDocumentId).toBeUndefined()
  })

  it('수신자가 직원이 아니면 아무것도 넣지 않습니다', async () => {
    const { employeeId: _, ...noEmployee } = request(1)
    const result = await run((intake) => intake.completed(noEmployee))
    expect(result.documents).toEqual([])
  })
})
