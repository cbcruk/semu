import { Effect } from 'effect'
import { HttpApiBuilder, HttpApiSchema } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { decodeHeaderText } from '../../../shared/personal-data/access-reason.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { EmployeeDocuments } from './employee-documents.ts'

/** 문서 보관함 핸들러입니다. 직원 정보라 읽기는 `employee:read`, 올리기·지우기는 `employee:update`를 씁니다. */
export const EmployeeDocumentsHttpLive = HttpApiBuilder.group(
  Api,
  'hrEmployeeDocuments',
  Effect.fn(function* (handlers) {
    const documents = yield* EmployeeDocuments
    const read = authorize(hrAccess('employee:read'))
    const write = authorize(hrAccess('employee:update'))

    return handlers.handleAll({
      list: ({ params, query }) =>
        read.pipe(
          Effect.flatMap((actor) => documents.list(actor, params.id, query.category)),
          Effect.map((items) => ({ items })),
        ),
      upload: ({ params, query, payload }) =>
        write.pipe(
          Effect.flatMap((actor) =>
            documents.upload(actor, params.id, {
              title: query.title,
              category: query.category,
              fileName: query.fileName,
              bytes: payload,
            }),
          ),
        ),
      get: ({ params }) => read.pipe(Effect.flatMap((actor) => documents.get(actor, params.documentId))),
      content: ({ params, headers }) =>
        read.pipe(
          Effect.flatMap((actor) =>
            documents.content(actor, params.documentId, decodeHeaderText(headers['x-access-reason'])),
          ),
          Effect.map((content) =>
            HttpApiSchema.withHeaders({
              body: content.bytes,
              headers: {
                'content-type': content.contentType,
                'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
              },
            }),
          ),
        ),
      remove: ({ params }) => write.pipe(Effect.flatMap((actor) => documents.remove(actor, params.documentId))),
    })
  }),
)
