import { Layer } from 'effect'
import { BusinessStatusesHttpLive } from './business-statuses/business-statuses.http.ts'
import { CertificateRepository } from './certificates/certificate-repository.ts'
import { SigningCertificatesHttpLive } from './certificates/certificates.http.ts'
import { Certificates } from './certificates/certificates.ts'
import { CredentialVault } from './credentials/credential-vault.ts'
import {
  demoCertificates,
  demoChannelTokens,
  demoCompanyProfiles,
  demoDelegations,
  demoIntegrations,
} from './demo-seed.ts'
import { DelegationRepository } from './hometax-delegations/hometax-delegation.ts'
import { HometaxDelegationsHttpLive } from './hometax-delegations/hometax-delegations.http.ts'
import { IntegrationRepository } from './integrations/integration-repository.ts'
import { IntegrationsResourceHttpLive } from './integrations/integrations.http.ts'
import { Integrations } from './integrations/integrations.ts'
import { ChannelTokenRepository } from './messenger-channels/messenger-channel.ts'
import { MessengerChannelsHttpLive } from './messenger-channels/messenger-channels.http.ts'
import { BusinessStatusClient } from './ports/business-status-client.ts'
import { CompanyProfiles } from './ports/company-profiles.ts'
import { GiroPaymentClient } from './ports/giro-payment-client.ts'
import { HometaxDelegationClient } from './ports/hometax-delegation-client.ts'
import { HometaxInvoiceClient } from './ports/hometax-invoice-client.ts'
import { ScrapedRecordSink } from './ports/scraped-record-sink.ts'
import { ScrapingGateway } from './ports/scraping-gateway.ts'
import { ScrapRequestRepository } from './scrap-requests/scrap-request-repository.ts'
import { ScrapRequestsHttpLive } from './scrap-requests/scrap-requests.http.ts'
import { ScrapRequests } from './scrap-requests/scrap-requests.ts'
import { ScrapQueue, ScrapWorker } from './scrap-requests/scrap-worker.ts'

const ServicesLive = Layer.mergeAll(Integrations.layer, Certificates.layer, ScrapRequests.layer)

/**
 * 기관 연동·인증서·수집 요청·홈택스 수임동의 컨텍스트의 핸들러 전체입니다. 저장소와 외부 연동 포트는 호출하는 쪽이 넣습니다.
 *
 * 필요한 것: 저장소들, `CredentialVault`, `ScrapingGateway`, `ScrapQueue`, `BusinessStatusClient`, `HometaxDelegationClient`,
 * 그리고 Identity & Access가 구현할 `CompanyProfiles` 포트입니다.
 */
export const IntegrationsHttpLive = Layer.mergeAll(
  IntegrationsResourceHttpLive,
  SigningCertificatesHttpLive,
  ScrapRequestsHttpLive,
  HometaxDelegationsHttpLive,
  BusinessStatusesHttpLive,
  MessengerChannelsHttpLive,
).pipe(Layer.provide(ServicesLive))

/**
 * Integrations가 소유한 저장소·금고와 기관 어댑터를 메모리 구현과 결정적인 가짜로 채웁니다.
 *
 * 사업자 상태조회·세금계산서 발급·지로 납부 어댑터는 다른 컨텍스트도 `integrations.public.ts`로 씁니다. 수집 큐는 넣지 않습니다.
 * 워커가 다른 컨텍스트의 `ScrapedRecordSink`를 써서, 그 포트를 채운 뒤 {@link ScrapQueueInlineLive}를 얹습니다.
 */
export const IntegrationsMemoryStoreLive = Layer.mergeAll(
  IntegrationRepository.layerMemory(demoIntegrations()),
  CertificateRepository.layerMemory(demoCertificates()),
  ScrapRequestRepository.layerMemory(),
  DelegationRepository.layerMemory(demoDelegations()),
  ChannelTokenRepository.layerMemory(demoChannelTokens()),
  CredentialVault.layerMemory(),
  ScrapingGateway.layerFake,
  BusinessStatusClient.layerFake(),
  HometaxDelegationClient.layerFake,
  HometaxInvoiceClient.layerFake,
  GiroPaymentClient.layerFake,
)

/**
 * Identity & Access·Bookkeeping이 구현하는 포트의 가짜입니다. 수집 레코드는 배열에 쌓고, 회사 정보는 데모 회사 표로 답합니다.
 * Integrations만 시험할 때 씁니다.
 */
export const IntegrationsPortFakesLive = Layer.mergeAll(
  CompanyProfiles.layerMemory(demoCompanyProfiles()),
  ScrapedRecordSink.layerRecording(),
)

/** 수집 요청을 같은 프로세스의 워커가 바로 처리하는 큐입니다. 저장소·어댑터와 `ScrapedRecordSink`·`CompanyProfiles`가 필요합니다. */
export const ScrapQueueInlineLive = ScrapQueue.layerInline.pipe(Layer.provide(ScrapWorker.layer))

/**
 * 기관 연동·인증서·수집 요청·홈택스 수임동의 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다. Integrations만 시험할 때 씁니다.
 *
 * 수집 요청은 같은 프로세스의 워커가 바로 처리합니다(`ScrapQueue.layerInline`).
 */
export const IntegrationsMemoryLive = ScrapQueueInlineLive.pipe(
  Layer.provideMerge(Layer.mergeAll(IntegrationsMemoryStoreLive, IntegrationsPortFakesLive)),
)
