import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { documentsAccess } from '../shared/documents-schemas.ts'
import { Certificates } from './certificates.ts'

/** 제증명 발급 핸들러입니다. */
export const CertificatesHttpLive = HttpApiBuilder.group(
  Api,
  'certificateIssuances',
  Effect.fn(function* (handlers) {
    const certificates = yield* Certificates

    return handlers.handleAll({
      list: ({ query }) =>
        authorize(documentsAccess('certificate-issuance:read')).pipe(
          Effect.flatMap((actor) => certificates.list(actor, query)),
        ),
      issue: ({ payload }) =>
        authorize(documentsAccess('certificate-issuance:create')).pipe(
          Effect.flatMap((actor) => certificates.issue(actor, payload)),
        ),
      get: ({ params }) =>
        authorize(documentsAccess('certificate-issuance:read')).pipe(
          Effect.flatMap((actor) => certificates.get(actor, params.id)),
          Effect.map(withEtag),
        ),
      send: ({ params, headers }) =>
        authorize(documentsAccess('certificate-issuance:send')).pipe(
          Effect.flatMap((actor) => certificates.send(actor, params.id, expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
      void: ({ params, headers }) =>
        authorize(documentsAccess('certificate-issuance:void')).pipe(
          Effect.flatMap((actor) => certificates.void(actor, params.id, expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
    })
  }),
)
