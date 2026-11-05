import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { Signing } from './signing.ts'

/** 서명자 링크 핸들러입니다. 인증을 거치지 않습니다. */
export const EsignLinksHttpLive = HttpApiBuilder.group(
  Api,
  'esignLinks',
  Effect.fn(function* (handlers) {
    const signing = yield* Signing

    return handlers.handleAll({
      summary: ({ params }) => signing.summary(params.token),
      verify: ({ params, payload }) => signing.verify(params.token, payload),
      complete: ({ params, headers, payload }) =>
        signing.complete(params.token, headers['x-signer-session'], payload.signerValues ?? {}),
    })
  }),
)
