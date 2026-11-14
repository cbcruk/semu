import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { demoDelegations, demoIntegrations } from '../demo-seed.ts'
import { DelegationRepository, hasAgreedDelegation } from '../hometax-delegations/hometax-delegation.ts'
import type { DelegationRecord } from '../hometax-delegations/hometax-delegation.ts'
import { IntegrationRepository } from '../integrations/integration-repository.ts'
import { ScrapRequestRepository } from './scrap-request-repository.ts'
import { ScrapRequests } from './scrap-requests.ts'
import { ScrapQueue } from './scrap-worker.ts'

const agreed = demoDelegations().filter((delegation) => delegation.companyId === TEST_COMPANY_ID)
const pending = agreed.map((delegation) => ({ ...delegation, status: 'REQUESTED' as const }))

function run<A, E>(delegations: DelegationRecord[], program: Effect.Effect<A, E, ScrapRequests>) {
  const enqueued: Array<Id<'scrapRequest'>> = []
  const layer = ScrapRequests.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        IntegrationRepository.layerMemory(demoIntegrations()),
        DelegationRepository.layerMemory(delegations),
        ScrapRequestRepository.layerMemory(),
        ScrapQueue.layerManual(enqueued),
      ),
    ),
  )
  return Effect.runPromise(program.pipe(Effect.provide(layer)))
}

describe('hasAgreedDelegation', () => {
  it('동의한 수임이 하나라도 있어야 참이고 동의 대기·해지는 세지 않습니다', () => {
    expect(hasAgreedDelegation([])).toBe(false)
    expect(hasAgreedDelegation([{ status: 'REQUESTED' }, { status: 'REVOKED' }])).toBe(false)
    expect(hasAgreedDelegation([{ status: 'REVOKED' }, { status: 'AGREED' }])).toBe(true)
  })
})

describe('홈택스 수집의 수임동의 확인', () => {
  const agent = testActor({ kind: 'AGENCY' })

  const request = (actor: ReturnType<typeof testActor>) =>
    Effect.gen(function* () {
      return yield* (yield* ScrapRequests).request(actor, { institutionType: 'HOMETAX' }, 'k-1')
    })

  it('세무대리인은 동의한 수임동의가 없으면 홈택스를 수동 수집할 수 없습니다', async () => {
    const error = await run(pending, Effect.flip(request(agent)))

    expect(error._tag).toBe('HometaxDelegationRequired')
  })

  it('세무대리인도 동의한 수임동의가 있으면 홈택스를 수집합니다', async () => {
    const job = await run(agreed, request(agent))

    expect(job).toMatchObject({ institutionType: 'HOMETAX', status: 'QUEUED' })
  })

  it('회사 사용자는 자기 자격 증명으로 수집하므로 수임동의가 없어도 홈택스를 수집합니다', async () => {
    const job = await run([], request(testActor()))

    expect(job).toMatchObject({ institutionType: 'HOMETAX', status: 'QUEUED' })
  })

  it('세무대리인의 전체 수집은 홈택스를 건너뛰고 수집 가능 여부도 수임동의가 없다고 알립니다', async () => {
    const result = await run(
      pending,
      Effect.gen(function* () {
        const service = yield* ScrapRequests
        const all = yield* service.requestAll(agent, 'all-1')
        const availability = yield* service.availability(agent)
        return { all, availability }
      }),
    )

    expect(result.all.skipped).toContainEqual({ institutionType: 'HOMETAX', reason: 'DELEGATION_REQUIRED' })
    expect(result.all.items.map((item) => item.institutionType)).not.toContain('HOMETAX')
    expect(result.availability.find((item) => item.institutionType === 'HOMETAX')).toMatchObject({
      isConnected: true,
      canRequest: false,
      reason: 'DELEGATION_REQUIRED',
    })
  })
})
