import { httpTestApp } from '../../../shared/testing/http-test-app.ts'
import type { HttpTestApp, HttpTestRequest } from '../../../shared/testing/http-test-app.ts'
import { testActor } from '../../identity-access/testing.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** HR HTTP 테스트 전용 회사입니다. 데모 시드가 없어 테스트가 빈 회사에서 시작합니다. */
export const HR_TEST_COMPANY_ID = 'cmp_01JBQ0000000000000000HRTST' as Id<'company'>

/** 테스트 요청 옵션입니다. 토큰 기본값은 모든 권한을 가진 `admin`입니다. */
export type TestRequest = HttpTestRequest

/** 같은 메모리 저장소를 공유하는 테스트 앱입니다. 경로는 `/v1` 뒤부터 씁니다. */
export type TestApp = HttpTestApp

/**
 * 메모리 저장소로 앱을 띄웁니다. 토큰은 `admin`(모든 권한), `viewer`(읽기 권한만), `no-plan`(플랜 없음), `agent`(세무 대리인)입니다.
 *
 * 행위자는 {@link HR_TEST_COMPANY_ID}에 속합니다.
 */
export function startTestApp(): TestApp {
  const companyId = HR_TEST_COMPANY_ID
  return httpTestApp({
    tokens: [
      ['admin', testActor({ companyId })],
      [
        'viewer',
        testActor({ companyId, permissions: new Set(['employee:read', 'organization:read', 'esign-request:read']) }),
      ],
      ['no-plan', testActor({ companyId, plans: new Set() })],
      ['agent', testActor({ companyId, kind: 'AGENCY' })],
    ],
    basePath: '/v1',
    defaultToken: 'admin',
  })
}
