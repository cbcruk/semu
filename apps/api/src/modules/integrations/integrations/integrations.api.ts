import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { PermissionDenied, ValidationFailed } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { CertificateNotFound } from '../certificates/certificate.ts'
import { InstitutionTypeSchema } from '../institutions/institution.ts'
import {
  AuthMethodNotSupported,
  Candidate,
  CandidateQuery,
  CertificateNotUsable,
  CredentialReplacement,
  InstitutionCredentialRejected,
  Integration,
  IntegrationDuplicate,
  IntegrationId,
  IntegrationItemNotFound,
  IntegrationLimitExceeded,
  IntegrationList,
  IntegrationNotFound,
  IntegrationRegistration,
  ItemPatch,
  PgKeysInvalid,
} from './integration.ts'

const integrationParams = { integrationId: IntegrationId }
const itemParams = { integrationId: IntegrationId, itemKey: Schema.String }

const registrationErrors = [
  PermissionDenied,
  ValidationFailed,
  AuthMethodNotSupported,
  IntegrationLimitExceeded,
  IntegrationDuplicate,
  PgKeysInvalid,
  InstitutionCredentialRejected,
  CertificateNotFound,
  CertificateNotUsable,
] as const

/**
 * 기관 연동입니다. 현행 유형별 경로(`/integrations/hometax`, `/integrations/bank` …)를 리소스 하나로 합칩니다.
 *
 * 등록은 기관 로그인을 동기로 확인합니다. 수집은 `/scrap-requests`로 따로 요청합니다.
 */
export class IntegrationsResourceApi extends HttpApiGroup.make('integrations')
  .add(
    HttpApiEndpoint.get('list', '/integrations', {
      query: Schema.Struct({ type: Schema.optionalKey(InstitutionTypeSchema) }),
      success: IntegrationList,
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('get', '/integrations/:integrationId', {
      params: integrationParams,
      success: Integration,
      error: [PermissionDenied, IntegrationNotFound],
    }),
    HttpApiEndpoint.post('listCandidates', '/integrations::list-candidates', {
      payload: CandidateQuery,
      success: Schema.Struct({ items: Schema.Array(Candidate) }),
      error: registrationErrors,
    }),
    HttpApiEndpoint.post('register', '/integrations', {
      payload: IntegrationRegistration,
      success: Integration.pipe(HttpApiSchema.status(201)),
      error: registrationErrors,
    }),
    HttpApiEndpoint.post('replaceCredentials', '/integrations/:integrationId::replace-credentials', {
      params: integrationParams,
      payload: CredentialReplacement,
      success: Integration,
      error: [
        PermissionDenied,
        IntegrationNotFound,
        ValidationFailed,
        InstitutionCredentialRejected,
        CertificateNotFound,
        CertificateNotUsable,
      ],
    }),
    HttpApiEndpoint.patch('patchItem', '/integrations/:integrationId/items/:itemKey', {
      params: itemParams,
      payload: ItemPatch,
      success: Integration,
      error: [PermissionDenied, IntegrationNotFound, IntegrationItemNotFound],
    }),
    HttpApiEndpoint.delete('removeItem', '/integrations/:integrationId/items/:itemKey', {
      params: itemParams,
      success: HttpApiSchema.NoContent,
      error: [PermissionDenied, IntegrationNotFound, IntegrationItemNotFound],
    }),
    HttpApiEndpoint.delete('remove', '/integrations/:integrationId', {
      params: integrationParams,
      success: HttpApiSchema.NoContent,
      error: [PermissionDenied, IntegrationNotFound],
    }),
  )
  .middleware(Authentication) {}
