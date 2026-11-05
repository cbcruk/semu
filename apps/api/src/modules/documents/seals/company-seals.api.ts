import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS, CompanySealId } from '../shared/documents-schemas.ts'
import { CompanySeal, CompanySealLimitExceeded, CompanySealNotFound, CompanySealRegistration } from './company-seal.ts'

/**
 * 회사 도장·사인입니다. 회사당 5개까지 두고, 지우면 소프트 삭제합니다. 이미 보낸 요청은 영향을 받지 않습니다.
 *
 * 이미지 내려받기(`GET /company-seals/{id}/image`)는 파일 저장소가 생기면 붙입니다.
 */
export class CompanySealsApi extends HttpApiGroup.make('companySeals')
  .add(
    HttpApiEndpoint.get('list', '/company-seals', {
      success: Schema.Struct({ items: Schema.Array(CompanySeal) }),
      error: ACCESS_ERRORS,
    }),
    HttpApiEndpoint.post('create', '/company-seals', {
      payload: CompanySealRegistration,
      success: CompanySeal.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, CompanySealLimitExceeded],
    }),
    HttpApiEndpoint.delete('remove', '/company-seals/:id', {
      params: { id: CompanySealId },
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, CompanySealNotFound],
    }),
  )
  .middleware(Authentication) {}
