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

describe('Leaves.remove', () => {
  it('withdraws both the leave filing and the return filing of the removed leave', async () => {
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

    expect(filings.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: 'LEAVE', status: 'WITHDRAWN' },
      { kind: 'RETURN', status: 'WITHDRAWN' },
    ])
  })
})
