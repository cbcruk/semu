import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { documentsAccess } from '../shared/documents-schemas.ts'
import { CompanySeals } from './company-seals.ts'

/** 회사 도장 핸들러입니다. 권한을 보고 서비스(`CompanySeals`)를 부릅니다. */
export const CompanySealsHttpLive = HttpApiBuilder.group(
  Api,
  'companySeals',
  Effect.fn(function* (handlers) {
    const seals = yield* CompanySeals

    return handlers.handleAll({
      list: () =>
        authorize(documentsAccess('company-seal:read')).pipe(
          Effect.flatMap((actor) => seals.list(actor)),
          Effect.map((items) => ({ items })),
        ),
      create: ({ payload }) =>
        authorize(documentsAccess('company-seal:create')).pipe(
          Effect.flatMap((actor) => seals.register(actor, payload)),
        ),
      remove: ({ params }) =>
        authorize(documentsAccess('company-seal:delete')).pipe(
          Effect.flatMap((actor) => seals.remove(actor, params.id)),
        ),
    })
  }),
)
