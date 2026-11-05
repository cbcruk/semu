import { HttpApi } from 'effect/http-api'

/**
 * 기관 연동·인증서·수집 요청·홈택스 수임동의 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 그룹을 추가할 때 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙입니다.
 */
export const IntegrationsApi = HttpApi.make('integrations')
