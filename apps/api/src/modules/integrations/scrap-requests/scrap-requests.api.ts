import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { IdempotencyKeyRequired, PermissionDenied } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { InstitutionTypeSchema } from '../institutions/institution.ts'
import { IntegrationItemNotFound, IntegrationNotFound } from '../integrations/integration.ts'
import {
  InstitutionNotConnected,
  ScrapAllResult,
  ScrapAvailabilityItem,
  ScrapRequest,
  ScrapRequestId,
  ScrapRequestInput,
  ScrapRequestNotFound,
  ScrapRequestTooSoon,
} from './scrap-request.ts'

const idempotencyHeaders = { 'idempotency-key': Schema.optionalKey(Schema.String) }

/**
 * 수동 수집 요청(`Job`)입니다. 현행 `request-scrapping/:service`, `request-all-scrapping`, `pg/scrap-request`,
 * `delivery/scrap-request`, `last-scrap-request-status`, `scraping-status`를 대신합니다.
 *
 * 외부 기관을 부르므로 `Idempotency-Key`가 필수입니다.
 */
export class ScrapRequestsApi extends HttpApiGroup.make('scrapRequests')
  .add(
    HttpApiEndpoint.post('request', '/scrap-requests', {
      headers: idempotencyHeaders,
      payload: ScrapRequestInput,
      success: ScrapRequest.pipe(HttpApiSchema.status(202)),
      error: [
        PermissionDenied,
        IdempotencyKeyRequired,
        InstitutionNotConnected,
        ScrapRequestTooSoon,
        IntegrationNotFound,
        IntegrationItemNotFound,
      ],
    }),
    HttpApiEndpoint.post('requestAll', '/scrap-requests::request-all', {
      headers: idempotencyHeaders,
      success: ScrapAllResult.pipe(HttpApiSchema.status(202)),
      error: [PermissionDenied, IdempotencyKeyRequired],
    }),
    HttpApiEndpoint.get('availability', '/scrap-requests::availability', {
      success: Schema.Struct({ items: Schema.Array(ScrapAvailabilityItem) }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('list', '/scrap-requests', {
      query: Schema.Struct({ institutionType: Schema.optionalKey(InstitutionTypeSchema) }),
      success: Schema.Struct({ items: Schema.Array(ScrapRequest) }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('get', '/scrap-requests/:scrapRequestId', {
      params: { scrapRequestId: ScrapRequestId },
      success: ScrapRequest,
      error: [PermissionDenied, ScrapRequestNotFound],
    }),
  )
  .middleware(Authentication) {}
