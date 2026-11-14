import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { testActor } from '../../identity-access/testing.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { InsuranceFilingRepository } from '../insurance-filings/insurance-filing-repository.ts'
import { LeaveRepository } from './leave.ts'
import { Leaves } from './leaves.ts'

const actor = testActor()
const employeeId = 'emp_01JBQ0000000000000000LEAV1' as Id<'employee'>

const layer = Leaves.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      LeaveRepository.layerMemory(),
      InsuranceFilingRepository.layerMemory(),
      EmployeeRepository.layerMemory([
        {
          id: employeeId,
          companyId: actor.companyId,
          kind: 'WAGE',
          name: '김휴직',
          joinDate: '2025-01-02',
          isRejoin: false,
          isForeigner: false,
          version: 1,
          createdAt: '2025-01-02T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
        },
      ]),
    ),
  ),
)

describe('휴직 삭제', () => {
  it('지운 휴직의 휴직 신고와 복직 신고를 모두 거둡니다', async () => {
    const filings = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Leaves
        const leave = yield* service.create(actor, employeeId, {
          reason: 'OTHER',
          startDate: '2026-03-02',
          endDate: '2026-03-31',
        })
        yield* service.returnFromLeave(actor, leave.id, '2026-03-20', undefined)
        yield* service.remove(actor, leave.id)
        return yield* (yield* InsuranceFilingRepository).listByEmployee(actor.companyId, employeeId)
      }).pipe(Effect.provide(layer)),
    )

    // 같은 밀리초에 만든 신고는 ID 순서가 정해지지 않아 종류로 줄 세웁니다.
    const byKind = filings
      .map(({ kind, status }) => ({ kind, status }))
      .toSorted((a, b) => a.kind.localeCompare(b.kind))
    expect(byKind).toEqual([
      { kind: 'LEAVE', status: 'WITHDRAWN' },
      { kind: 'RETURN', status: 'WITHDRAWN' },
    ])
  })
})
