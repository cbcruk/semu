import { Layer } from 'effect'
import { FileStore } from '../../shared/files/file-store.ts'
import { TableFactory } from '../../shared/persistence/record-table.ts'
import { CertificateIssuanceRepository } from './certificates/certificate-issuance.ts'
import { Certificates } from './certificates/certificates.ts'
import { CertificatesHttpLive } from './certificates/certificates.http.ts'
import { EsignRequestRepository } from './esign/esign-request.ts'
import { EsignRequests } from './esign/esign-requests.ts'
import { EsignRequestsHttpLive } from './esign/esign-requests.http.ts'
import { CompanySealRepository } from './seals/company-seal.ts'
import { CompanySealsHttpLive } from './seals/company-seals.http.ts'
import { DocumentEvents, DocumentNotifier, PdfRenderer, SignerIdentityVerifier } from './shared/documents-ports.ts'
import { EsignLinksHttpLive } from './signing/esign-links.http.ts'
import { Signing } from './signing/signing.ts'
import { EsignTemplateRepository } from './templates/esign-template.ts'
import { EsignTemplatesHttpLive } from './templates/esign-templates.http.ts'

/**
 * 전자서명·제증명 발급·서식 모음 컨텍스트의 핸들러 전체입니다.
 *
 * 필요한 것: `EsignRequestRepository`, `EsignTemplateRepository`, `CompanySealRepository`, `CertificateIssuanceRepository`,
 * `DocumentNotifier`, `PdfRenderer`, `SignerIdentityVerifier`, `DocumentEvents`, 인사의 `HrDirectory`.
 */
export const DocumentsHttpLive = Layer.mergeAll(
  EsignRequestsHttpLive,
  EsignLinksHttpLive,
  EsignTemplatesHttpLive,
  CompanySealsHttpLive,
  CertificatesHttpLive,
).pipe(Layer.provide(Layer.mergeAll(EsignRequests.layer, Signing.layer, Certificates.layer)))

/**
 * 정기 작업 `documents.esign-expiry`([esign-expiry-task.ts](./esign/esign-expiry-task.ts))가 쓰는 전자서명 요청 서비스입니다.
 * 필요한 저장소·포트는 {@link DocumentsHttpLive}와 같습니다.
 */
export const EsignRequestsLive = EsignRequests.layer

/**
 * 전자서명·제증명 발급·서식 모음 컨텍스트의 저장소와 외부 연동입니다. 요청·발급 기록과 회사 도장은 `TableFactory`(메모리 또는 SQLite)에 둡니다.
 * 데모 회사(법인)에 도장 하나가 들어 있습니다.
 *
 * 기본 템플릿은 코드에 있는 참조 데이터라 표에 두지 않습니다. 알림·본인확인은 아직 외부 구현이 없어 결정적인 가짜입니다.
 * PDF는 글자만 적은 한 쪽짜리를 만들어 공통 파일 저장소(`FileStore`)에 넣습니다. `FileStore`는 호출하는 쪽이 넣습니다.
 * 이벤트를 내보내는 `DocumentEvents`는 넣지 않습니다. 앱은 HR로 넘기는 구현(`src/wiring/documents-hr.ts`)을 넣습니다.
 */
export const DocumentsStoreLive = Layer.mergeAll(
  EsignRequestRepository.layer(),
  EsignTemplateRepository.layerMemory(),
  CompanySealRepository.layer(),
  CertificateIssuanceRepository.layer(),
  DocumentNotifier.layerFake,
  PdfRenderer.layerMinimal,
  SignerIdentityVerifier.layerNameAndBirthDate,
)

/** {@link DocumentsStoreLive}를 메모리 표로 채우고 이벤트는 버립니다. 문서 컨텍스트만 띄울 때 씁니다. */
export const DocumentsMemoryLive = Layer.merge(DocumentsStoreLive, DocumentEvents.layerDiscard).pipe(
  Layer.provideMerge(FileStore.layer),
  Layer.provide(TableFactory.layerMemory),
)
