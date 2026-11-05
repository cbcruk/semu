import { Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { documentsAccess } from '../shared/documents-schemas.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import {
  EsignTemplateNotFound,
  EsignTemplateRepository,
  type EsignTemplate,
  type EsignTemplateRecord,
} from './esign-template.ts'

const toView = (template: EsignTemplateRecord): EsignTemplate =>
  stripUndefined({ ...template, fields: template.fields.map((field) => stripUndefined(field)) })

/** 템플릿 조회 핸들러입니다. */
export const EsignTemplatesHttpLive = HttpApiBuilder.group(
  Api,
  'esignTemplates',
  Effect.fn(function* (handlers) {
    const templates = yield* EsignTemplateRepository
    const read = authorize(documentsAccess('esign-template:read'))

    return handlers.handleAll({
      list: () =>
        read.pipe(
          Effect.flatMap(() => templates.list()),
          Effect.map((all) => ({ items: all.map(toView) })),
        ),
      get: ({ params }) =>
        read.pipe(
          Effect.flatMap(() => templates.find(params.id)),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new EsignTemplateNotFound({})),
              onSome: (template) => Effect.succeed(toView(template)),
            }),
          ),
        ),
    })
  }),
)
