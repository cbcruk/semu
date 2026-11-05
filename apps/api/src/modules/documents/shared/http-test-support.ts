import { httpTestApp } from '../../../shared/testing/http-test-app.ts'
import type { HttpTestApp, HttpTestRequest } from '../../../shared/testing/http-test-app.ts'
import { testActor } from '../../identity-access/testing.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 데모 데이터가 없는 다른 회사입니다. */
export const OTHER_COMPANY_ID = 'cmp_01JBQ0000000000000000OTHER' as Id<'company'>

/** 테스트 요청 옵션입니다. 토큰 기본값은 모든 권한을 가진 `admin`입니다. */
export type TestRequest = HttpTestRequest

/** 같은 메모리 저장소를 공유하는 테스트 앱입니다. 경로는 `/v1` 뒤부터 씁니다. */
export type TestApp = HttpTestApp

/**
 * 메모리 저장소로 앱을 띄웁니다. 토큰은 `admin`(모든 권한), `viewer`(읽기 권한만), `no-plan`(플랜 없음),
 * `other-company`(데모 도장이 없는 다른 회사의 모든 권한)입니다.
 */
export function startTestApp(): TestApp {
  return httpTestApp({
    tokens: [
      ['admin', testActor()],
      ['viewer', testActor({ permissions: new Set(['employee:read', 'organization:read', 'esign-request:read']) })],
      ['no-plan', testActor({ plans: new Set() })],
      ['other-company', testActor({ companyId: OTHER_COMPANY_ID })],
    ],
    basePath: '/v1',
    defaultToken: 'admin',
  })
}
