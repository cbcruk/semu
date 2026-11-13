import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { EmployeeDocuments } from './employee-documents.ts'

/** 문서 보관함 핸들러입니다. 직원 정보라 `employee:read` 권한을 씁니다. */
export const EmployeeDocumentsHttpLive = HttpApiBuilder.group(
  Api,
  'hrEmployeeDocuments',
  Effect.fn(function* (handlers) {
    const documents = yield* EmployeeDocuments
    const read = authorize(hrAccess('employee:read'))

    return handlers.handleAll({
      list: ({ params, query }) =>
        read.pipe(
          Effect.flatMap((actor) => documents.list(actor, params.id, query.category)),
          Effect.map((items) => ({ items })),
        ),
      get: ({ params }) => read.pipe(Effect.flatMap((actor) => documents.get(actor, params.documentId))),
    })
  }),
)
