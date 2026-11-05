import { HttpApi } from 'effect/http-api'
import { CertificatesApi } from './certificates/certificates.api.ts'
import { EsignRequestsApi } from './esign/esign-requests.api.ts'
import { EsignLinksApi } from './signing/esign-links.api.ts'
import { EsignTemplatesApi } from './templates/esign-templates.api.ts'

/**
 * 전자서명·제증명 발급·서식 모음 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 서명자 링크(`esignLinks`)만 인증 없이 링크 토큰으로 들어오고, 나머지 그룹은 `.middleware(Authentication)`을 붙입니다.
 */
export const DocumentsApi = HttpApi.make('documents')
  .add(EsignRequestsApi)
  .add(EsignLinksApi)
  .add(EsignTemplatesApi)
  .add(CertificatesApi)
