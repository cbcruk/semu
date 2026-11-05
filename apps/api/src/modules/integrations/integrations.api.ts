import { HttpApi } from 'effect/http-api'
import { BusinessStatusesApi } from './business-statuses/business-statuses.api.ts'
import { SigningCertificatesApi } from './certificates/certificates.api.ts'
import { HometaxDelegationsApi } from './hometax-delegations/hometax-delegations.api.ts'
import { IntegrationsResourceApi } from './integrations/integrations.api.ts'
import { MessengerChannelsApi } from './messenger-channels/messenger-channels.api.ts'
import { ScrapRequestsApi } from './scrap-requests/scrap-requests.api.ts'

/**
 * 기관 연동·인증서·수집 요청·홈택스 수임동의 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 그룹을 추가할 때 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙입니다.
 */
export const IntegrationsApi = HttpApi.make('integrations')
  .add(IntegrationsResourceApi)
  .add(SigningCertificatesApi)
  .add(ScrapRequestsApi)
  .add(HometaxDelegationsApi)
  .add(BusinessStatusesApi)
  .add(MessengerChannelsApi)
