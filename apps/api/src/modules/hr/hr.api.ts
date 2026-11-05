import { HttpApi } from 'effect/http-api'

/**
 * 직원·조직·근로/급여계약·휴직·퇴직·4대보험 자격 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 그룹을 추가할 때 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙입니다.
 */
export const HrApi = HttpApi.make('hr')
