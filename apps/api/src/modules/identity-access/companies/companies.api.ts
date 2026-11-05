import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import {
  EntitlementRequired,
  PermissionDenied,
  TermsReagreementRequired,
  Unauthenticated,
  VersionMismatch,
} from '../../../shared/problem/problem.ts'
import { Authentication } from '../authentication.ts'
import {
  BusinessNumberInvalid,
  Company,
  CompanyAlreadyRegistered,
  CompanyPatch,
  CompanyRegistration,
} from './company.ts'

const withEtag = HttpApiSchema.WithHeaders(Company, { etag: Schema.String })

/** 지금 토큰이 묶인 회사의 정보입니다. 경로에 회사 ID를 넣지 않습니다. */
export class CurrentCompanyApi extends HttpApiGroup.make('currentCompany')
  .add(
    HttpApiEndpoint.get('get', '/companies/current', {
      success: withEtag,
      error: [PermissionDenied, EntitlementRequired, TermsReagreementRequired],
    }),
    HttpApiEndpoint.patch('update', '/companies/current', {
      headers: { 'if-match': Schema.optionalKey(Schema.String) },
      payload: CompanyPatch,
      success: withEtag,
      error: [PermissionDenied, EntitlementRequired, TermsReagreementRequired, VersionMismatch],
    }),
  )
  .middleware(Authentication) {}

/**
 * 새 회사 등록입니다. 회사가 없는 사용자도 부르므로 `Authentication` 대신 핸들러가 토큰을 직접 확인합니다.
 *
 * `Authorization: Bearer`에는 access token이나 로그인 응답의 `onboardingToken`을 보냅니다.
 */
export class CompanyRegistrationsApi extends HttpApiGroup.make('companyRegistrations').add(
  HttpApiEndpoint.post('register', '/companies', {
    headers: { authorization: Schema.optionalKey(Schema.String) },
    payload: CompanyRegistration,
    success: Company.pipe(HttpApiSchema.status(201)),
    error: [Unauthenticated, BusinessNumberInvalid, CompanyAlreadyRegistered],
  }),
) {}
