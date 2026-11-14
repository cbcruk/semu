import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { testActor } from '../../identity-access/testing.ts'
import { CertificateRepository } from '../certificates/certificate-repository.ts'
import { CredentialVault } from '../credentials/credential-vault.ts'
import {
  demoCertificates,
  demoCompanyProfiles,
  demoDelegations,
  demoIntegrations,
  DEMO_INTEGRATION_IDS,
} from '../demo-seed.ts'
import { DelegationRepository } from '../hometax-delegations/hometax-delegation.ts'
import { IntegrationRepository } from '../integrations/integration-repository.ts'
import { Integrations } from '../integrations/integrations.ts'
import { CompanyProfiles } from '../ports/company-profiles.ts'
import { ScrapedRecordSink } from '../ports/scraped-record-sink.ts'
import type { ScrapedBatch } from '../ports/scraped-record-sink.ts'
import { ScrapingGateway } from '../ports/scraping-gateway.ts'
import { ScrapRequestRepository } from './scrap-request-repository.ts'
import { ScrapRequests } from './scrap-requests.ts'
import { ScrapQueue, ScrapWorker } from './scrap-worker.ts'

const actor = testActor()

function setup() {
  const received: ScrapedBatch[] = []
  const enqueued: Array<Id<'scrapRequest'>> = []
  const ports = Layer.mergeAll(
    IntegrationRepository.layerMemory(demoIntegrations()),
    CertificateRepository.layerMemory(demoCertificates()),
    ScrapRequestRepository.layerMemory(),
    DelegationRepository.layerMemory(demoDelegations()),
    CredentialVault.layerMemory(),
    ScrapingGateway.layerFake,
    CompanyProfiles.layerMemory(demoCompanyProfiles()),
    ScrapedRecordSink.layerRecording(received),
    ScrapQueue.layerManual(enqueued),
  )
  const layer = Layer.mergeAll(ScrapRequests.layer, ScrapWorker.layer, Integrations.layer).pipe(
    Layer.provideMerge(ports),
  )
  const run = <A, E>(
    program: Effect.Effect<A, E, ScrapRequests | ScrapWorker | Integrations | IntegrationRepository>,
  ): Promise<A> => Effect.runPromise(program.pipe(Effect.provide(layer)))
  return { received, enqueued, run }
}

describe('수집 작업자', () => {
  it('요청을 대기열에 넣고 진행 중에는 다음 요청을 막으며 수집한 내역을 Bookkeeping에 넘깁니다', async () => {
    const { received, enqueued, run } = setup()

    const result = await run(
      Effect.gen(function* () {
        const requests = yield* ScrapRequests
        const worker = yield* ScrapWorker
        const queued = yield* requests.request(actor, { institutionType: 'BANK' }, 'key-1')
        const blocked = yield* Effect.flip(requests.request(actor, { institutionType: 'BANK' }, 'key-2'))
        yield* worker.run(actor.companyId, queued.id)
        const done = yield* requests.get(actor, queued.id)
        const replay = yield* requests.request(actor, { institutionType: 'BANK' }, 'key-1')
        return { queued, blocked, done, replay }
      }),
    )

    expect(result.queued).toMatchObject({ status: 'QUEUED', requester: 'USER', isInitial: true })
    expect(enqueued).toEqual([result.queued.id])
    expect(result.blocked).toMatchObject({ _tag: 'ScrapRequestTooSoon', reason: 'RUNNING' })
    expect(result.done.status).toBe('SUCCEEDED')
    expect(result.done.result?.items.map((item) => item.itemKey)).toEqual(['004-1', '004-2'])
    expect(received.map((batch) => [batch.integrationId, batch.itemKey, batch.records.length])).toEqual([
      [DEMO_INTEGRATION_IDS.bank, '004-1', 2],
      [DEMO_INTEGRATION_IDS.bank, '004-2', 2],
    ])
    expect(result.replay.id).toBe(result.queued.id)
  })

  it('일부 실패를 항목별로 알리고 실패한 항목에만 RETRY를 내놓습니다', async () => {
    const { run } = setup()

    const { request, failing } = await run(
      Effect.gen(function* () {
        const integrations = yield* Integrations
        const requests = yield* ScrapRequests
        const worker = yield* ScrapWorker
        const failing = yield* integrations.register(actor, {
          type: 'BANK',
          authMethod: 'ID_PASSWORD',
          institutionCodes: ['fail-bank'],
          accountId: 'flaky',
          password: 'secret-1',
          itemKeys: ['fail-bank-1'],
        })
        const queued = yield* requests.request(actor, { institutionType: 'BANK' }, 'key-1')
        yield* worker.run(actor.companyId, queued.id)
        return {
          request: yield* requests.get(actor, queued.id),
          failing: yield* integrations.get(actor, failing.id),
        }
      }),
    )

    expect(request.status).toBe('PARTIALLY_SUCCEEDED')
    expect(failing.items[0]).toMatchObject({
      key: 'fail-bank-1',
      lastScrap: { status: 'FAILED', code: 'INSTITUTION_UNAVAILABLE', isRetryable: true },
    })
    expect(failing.items[0]?.allowedActions).toContain('RETRY')
    expect(failing.allowedActions).toContain('RETRY')
  })

  it('비밀번호를 평문으로 저장하지 않습니다', async () => {
    const { run } = setup()

    const stored = await run(
      Effect.gen(function* () {
        const integrations = yield* Integrations
        const repository = yield* IntegrationRepository
        const created = yield* integrations.register(actor, {
          type: 'CARD_SALES',
          authMethod: 'ID_PASSWORD',
          accountId: 'crefia',
          password: 'very-secret-password',
        })
        return yield* repository.find(actor.companyId, created.id)
      }),
    )

    expect(JSON.stringify(stored)).not.toContain('very-secret-password')
  })
})
