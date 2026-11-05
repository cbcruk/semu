import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { requirePermission } from '../access.ts'
import { Certificates } from './certificates.ts'

/** 공동인증서 핸들러입니다. */
export const SigningCertificatesHttpLive = HttpApiBuilder.group(
  Api,
  'signingCertificates',
  Effect.fn(function* (handlers) {
    const certificates = yield* Certificates
    return handlers.handleAll({
      list: () =>
        requirePermission('certificate:read').pipe(
          Effect.flatMap(certificates.list),
          Effect.map((items) => ({ items })),
        ),
      register: ({ payload }) =>
        requirePermission('certificate:create').pipe(Effect.flatMap((actor) => certificates.register(actor, payload))),
      remove: ({ params }) =>
        requirePermission('certificate:delete').pipe(
          Effect.flatMap((actor) => certificates.remove(actor, params.certificateId)),
        ),
      verifyPassword: ({ params, payload }) =>
        requirePermission('certificate:read').pipe(
          Effect.flatMap((actor) => certificates.verifyPassword(actor, params.certificateId, payload.signPassword)),
        ),
      joinGiro: ({ params, payload }) =>
        requirePermission('integration:create').pipe(
          Effect.flatMap((actor) =>
            certificates.joinGiro(actor, params.certificateId, {
              giroLoginId: payload.giroLoginId,
              giroPassword: payload.giroPassword,
              email: payload.email,
              phone: payload.phone,
            }),
          ),
        ),
    })
  }),
)
