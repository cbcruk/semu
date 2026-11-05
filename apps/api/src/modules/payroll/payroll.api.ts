import { HttpApi } from 'effect/http-api'

/**
 * 급여 계산 엔진·기준표·급여 설정·급여대장·명세서·퇴직금 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 그룹을 추가할 때 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙입니다.
 */
export const PayrollApi = HttpApi.make('payroll')
