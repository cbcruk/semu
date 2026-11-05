import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { Grant, GrantId, GrantNotFound } from './grant.ts'

const accessErrors = [PermissionDenied, EntitlementRequired, TermsReagreementRequired] as const

/**
 * 지원사업 공고와 맞춤 추천입니다. 현행 `/recommend/grant` 화면과 레거시 `GET /api/company/:id/grants/recommendations`입니다.
 *
 * 메뉴 권한 없이 모든 사용자가 봅니다(`grant:read`는 기본 권한). 약관 게이트도 걸지 않습니다.
 */
export class GrantsApi extends HttpApiGroup.make('grants')
  .add(
    HttpApiEndpoint.get('list', '/grants', {
      query: Schema.Struct(PageQueryFields),
      success: Page(Grant),
      error: accessErrors,
    }),
    HttpApiEndpoint.get('get', '/grants/:grantId', {
      params: Schema.Struct({ grantId: GrantId }),
      success: Grant,
      error: [...accessErrors, GrantNotFound],
    }),
    HttpApiEndpoint.get('recommend', '/grant-recommendations', {
      success: Schema.Struct({ items: Schema.Array(Grant) }),
      error: accessErrors,
    }),
  )
  .middleware(Authentication) {}
