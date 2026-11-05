import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS, EsignTemplateId } from '../shared/documents-schemas.ts'
import { EsignTemplate, EsignTemplateNotFound } from './esign-template.ts'

/** 전자서명·제증명 템플릿입니다. 지금은 기본 템플릿 조회만 있습니다. */
export class EsignTemplatesApi extends HttpApiGroup.make('esignTemplates')
  .add(
    HttpApiEndpoint.get('list', '/esign-templates', {
      success: Schema.Struct({ items: Schema.Array(EsignTemplate) }),
      error: ACCESS_ERRORS,
    }),
    HttpApiEndpoint.get('get', '/esign-templates/:id', {
      params: { id: EsignTemplateId },
      success: EsignTemplate,
      error: [...ACCESS_ERRORS, EsignTemplateNotFound],
    }),
  )
  .middleware(Authentication) {}
