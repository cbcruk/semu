import { HttpApi } from 'effect/http-api'

/**
 * 증빙·계정과목·자동분류·입출금·거래처·세금계산서·지로·결산 보고서 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 그룹을 추가할 때 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙입니다.
 */
export const BookkeepingApi = HttpApi.make('bookkeeping')
