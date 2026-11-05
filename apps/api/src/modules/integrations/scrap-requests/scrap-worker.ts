import { Clock, Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { CertificateRepository } from '../certificates/certificate-repository.ts'
import { CredentialVault } from '../credentials/credential-vault.ts'
import { IntegrationRepository } from '../integrations/integration-repository.ts'
import type { IntegrationRecord, LastScrap } from '../integrations/integration.ts'
import { CompanyProfiles } from '../ports/company-profiles.ts'
import { ScrapedRecordSink } from '../ports/scraped-record-sink.ts'
import { ScrapingGateway } from '../ports/scraping-gateway.ts'
import type { GatewayCredential, GatewayScrapOutcome } from '../ports/scraping-gateway.ts'
import { summarizeItemResults } from './scrap-cooldown.ts'
import { ScrapRequestRepository } from './scrap-request-repository.ts'
import type { ScrapItemResult, ScrapRequestRecord } from './scrap-request.ts'

/**
 * 수집 요청을 처리하는 워커입니다. 자격 증명을 이 경계 안에서만 열고, 가져온 레코드는 {@link ScrapedRecordSink}로 넘깁니다.
 *
 * 연동과 항목의 `lastScrap`을 갱신해 재시도 판정과 상태 화면에 씁니다.
 */
export class ScrapWorker extends Context.Service<
  ScrapWorker,
  {
    run(companyId: Id<'company'>, requestId: Id<'scrapRequest'>): Effect.Effect<void>
  }
>()('semu/integrations/ScrapWorker') {
  /** 저장소·금고·수집 어댑터·레코드 포트로 만듭니다. */
  static readonly layer = Layer.effect(
    ScrapWorker,
    Effect.gen(function* () {
      const requests = yield* ScrapRequestRepository
      const integrations = yield* IntegrationRepository
      const certificates = yield* CertificateRepository
      const vault = yield* CredentialVault
      const gateway = yield* ScrapingGateway
      const sink = yield* ScrapedRecordSink
      const profiles = yield* CompanyProfiles

      const credentialOf = Effect.fn(function* (integration: IntegrationRecord) {
        const secret = integration.credential === undefined ? {} : yield* vault.open(integration.credential)
        let certificate: GatewayCredential['certificate']
        if (integration.certificateId !== undefined) {
          const found = yield* certificates.find(integration.companyId, integration.certificateId)
          if (Option.isNone(found) || found.value.deletedAt !== undefined) return undefined
          const fields = yield* vault.open(found.value.secret)
          certificate = { bundle: fields['bundle'] ?? '', signPassword: fields['signPassword'] ?? '' }
        }
        const { password, ...keys } = secret
        return {
          authMethod: integration.authMethod,
          ...(integration.accountId === undefined ? {} : { accountId: integration.accountId }),
          ...(password === undefined ? {} : { password }),
          ...(integration.authMethod === 'API_KEY' ? { keys: { ...integration.publicKeys, ...keys } } : {}),
          ...(certificate === undefined ? {} : { certificate }),
        } satisfies GatewayCredential
      })

      const scrapeOne = Effect.fn(function* (request: ScrapRequestRecord, integration: IntegrationRecord) {
        const itemKeys =
          request.itemKey !== undefined
            ? [request.itemKey]
            : integration.items.filter((item) => item.isActive).map((item) => item.key)
        const credential = yield* credentialOf(integration)
        let outcomes: GatewayScrapOutcome[]
        if (credential === undefined) {
          outcomes = [{ status: 'FAILED', code: 'CERTIFICATE_UNREGISTERED', isRetryable: false }]
        } else {
          const company = yield* profiles.profileOf(request.companyId)
          outcomes = yield* gateway.scrape({
            companyId: request.companyId,
            businessNumber: Option.match(company, { onNone: () => '', onSome: (found) => found.businessNumber }),
            type: integration.type,
            ...(integration.institutionCode === undefined ? {} : { institutionCode: integration.institutionCode }),
            itemKeys,
            credential,
            isInitial: integration.lastScrap === undefined,
            options: request.options ?? {},
          })
        }
        const finishedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
        const results: ScrapItemResult[] = []
        for (const outcome of outcomes) {
          if (outcome.status === 'SUCCEEDED') {
            yield* sink.accept({
              companyId: request.companyId,
              institutionType: integration.type,
              integrationId: integration.id,
              ...(outcome.itemKey === undefined ? {} : { itemKey: outcome.itemKey }),
              scrapRequestId: request.id,
              isInitial: integration.lastScrap === undefined,
              records: outcome.records,
            })
          }
          results.push({
            integrationId: integration.id,
            ...(outcome.itemKey === undefined ? {} : { itemKey: outcome.itemKey }),
            status: outcome.status,
            ...(outcome.status === 'FAILED' ? { code: outcome.code } : {}),
            isRetryable: outcome.status === 'SUCCEEDED' || outcome.isRetryable,
            recordCount: outcome.status === 'SUCCEEDED' ? outcome.records.length : 0,
          })
        }
        const lastOf = (result: ScrapItemResult): LastScrap => ({
          status: result.status,
          ...(result.code === undefined ? {} : { code: result.code }),
          isRetryable: result.isRetryable,
          finishedAt,
        })
        const failed = results.find((result) => result.status === 'FAILED')
        const summary = failed ?? results[0]
        yield* integrations.save({
          ...integration,
          ...(summary === undefined ? {} : { lastScrap: lastOf(summary) }),
          items: integration.items.map((item) => {
            const result = results.find((candidate) => candidate.itemKey === item.key)
            return result === undefined ? item : { ...item, lastScrap: lastOf(result) }
          }),
        })
        return results
      })

      return ScrapWorker.of({
        run: Effect.fn(function* (companyId, requestId) {
          const found = yield* requests.find(companyId, requestId)
          if (Option.isNone(found) || found.value.status !== 'QUEUED') return
          const startedAt = yield* Clock.currentTimeMillis
          const running: ScrapRequestRecord = { ...found.value, status: 'RUNNING', startedAt }
          yield* requests.save(running)
          const scope = yield* integrations.listByCompany(companyId, running.institutionType)
          const targets =
            running.integrationId === undefined ? scope : scope.filter((link) => link.id === running.integrationId)
          const results = (yield* Effect.forEach(targets, (integration) => scrapeOne(running, integration))).flat()
          yield* requests.save({
            ...running,
            status: summarizeItemResults(results.map((result) => result.status)),
            results,
            finishedAt: yield* Clock.currentTimeMillis,
          })
        }),
      })
    }),
  )
}

/**
 * 수집 요청을 워커에 넘기는 큐 포트입니다. 운영에서는 메시지 큐이고, 워커는 따로 돕니다.
 */
export class ScrapQueue extends Context.Service<
  ScrapQueue,
  {
    enqueue(companyId: Id<'company'>, requestId: Id<'scrapRequest'>): Effect.Effect<void>
  }
>()('semu/integrations/ScrapQueue') {
  /** 넣자마자 같은 프로세스의 {@link ScrapWorker}가 처리합니다. 로컬 개발용입니다. */
  static readonly layerInline = Layer.effect(
    ScrapQueue,
    Effect.gen(function* () {
      const worker = yield* ScrapWorker
      return ScrapQueue.of({ enqueue: (companyId, requestId) => worker.run(companyId, requestId) })
    }),
  )

  /** 넣은 요청을 `enqueued`에 쌓기만 합니다. 진행 중인 요청을 시험할 때 씁니다. */
  static readonly layerManual = (enqueued: Array<Id<'scrapRequest'>> = []) =>
    Layer.succeed(
      ScrapQueue,
      ScrapQueue.of({
        enqueue: (_, requestId) =>
          Effect.sync(() => {
            enqueued.push(requestId)
          }),
      }),
    )
}
