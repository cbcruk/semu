import { httpTestApp } from '../../shared/testing/http-test-app.ts'
import type { HttpTestResponse } from '../../shared/testing/http-test-app.ts'
import type { Id } from '../../shared/ids/ids.types.ts'
import { testActor } from '../identity-access/testing.ts'
import { taxMemoryLayer } from './tax.layer.ts'
import type { TaxMemorySeed } from './tax.layer.ts'

/**
 * 테스트 토큰입니다. `client`는 고객 관리자, `agency`는 세무 대리인, `free`는 플랜이 없는 고객, `individual`은 개인사업자,
 * `viewer`는 신고 건 읽기만 하는 고객, `pendingTerms`는 세무 약관 재동의 전의 관리자, `demo`는 데모 관리자입니다.
 * `otherAgency`는 다른 회사에 배정된 세무 대리인입니다. 배정되지 않은 회사의 회사 토큰은 발급되지 않으므로, 이 토큰이 그 대리인이
 * 가질 수 있는 전부입니다.
 */
export const TEST_TOKENS = {
  client: testActor(),
  agency: testActor({ kind: 'AGENCY' }),
  otherAgency: testActor({
    kind: 'AGENCY',
    userId: 'usr_01JBQ000000000000000000009' as Id<'user'>,
    companyId: 'cmp_01JBQ000000000000000000009' as Id<'company'>,
  }),
  free: testActor({ plans: new Set() }),
  individual: testActor({ businessType: 'INDIVIDUAL' }),
  viewer: testActor({ permissions: new Set(['filing:read', 'action-card:read']) }),
  pendingTerms: testActor({ pendingTermCodes: ['TAX_SERVICE'] }),
  demo: testActor({ isDemo: true }),
} as const

/** 테스트 앱에 보내는 요청입니다. */
export interface TaxTestRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  token?: keyof typeof TEST_TOKENS
  body?: unknown
  ifMatch?: string
}

/** 테스트 응답입니다. 본문을 단언하기 쉽게 `json()`을 느슨하게 둡니다. */
export type TaxTestResponse = HttpTestResponse

/** 테스트 앱입니다. 요청 사이에 메모리 저장소 상태가 이어집니다. */
export interface TaxTestApp {
  send(path: string, request?: TaxTestRequest): Promise<TaxTestResponse>
  dispose(): Promise<void>
}

/** 세무 저장소를 `seed`로 채운 앱 전체를 띄웁니다. 다른 컨텍스트는 `TestStoreLive`를 씁니다. */
export function taxTestApp(seed: TaxMemorySeed = {}): TaxTestApp {
  const app = httpTestApp({
    tokens: Object.entries(TEST_TOKENS),
    layers: [taxMemoryLayer(seed)],
    basePath: '/v1',
    defaultToken: 'client',
  })
  return {
    send: (path, { method, ...request } = {}) =>
      app.request(method ?? (request.body === undefined ? 'GET' : 'POST'), path, request),
    dispose: app.dispose,
  }
}
