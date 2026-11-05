import { HttpApi } from 'effect/http-api'
import { MeApi } from './me/me.api.ts'
import { SessionsApi } from './sessions/sessions.api.ts'
import { TermAgreementsApi, TermsApi } from './terms/terms.api.ts'

/**
 * 인증·회사(테넌트)·사용자·역할·약관·초대 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 그룹을 추가할 때 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙입니다.
 */
export const IdentityAccessApi = HttpApi.make('identity-access')
  .add(SessionsApi)
  .add(MeApi)
  .add(TermsApi)
  .add(TermAgreementsApi)
