import { HttpApi } from 'effect/http-api'

/**
 * AI 비서·지원사업 추천 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 그룹을 추가할 때 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙입니다.
 */
export const AssistantApi = HttpApi.make('assistant')
