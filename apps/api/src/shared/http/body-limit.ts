import { ByteSize, Effect } from 'effect'
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerRespondable } from 'effect/http'
import { FileSizeInvalid } from '../files/file-errors.ts'
import { MAX_FILE_BYTES } from '../files/file-store.ts'
import { UnsupportedMediaType } from '../problem/problem.ts'

/** 앱 전체 요청 본문 상한(바이트)입니다. 가장 큰 본문인 파일 하나의 상한과 같습니다. */
export const MAX_BODY_BYTES = MAX_FILE_BYTES

/**
 * 요청 본문을 받기 전의 공통 검사입니다.
 *
 * - 본문이 {@link MAX_BODY_BYTES}를 넘으면 413 `FILE_SIZE_INVALID`입니다. `Content-Length`가 넘으면 본문을 읽지 않고 바로
 *   응답하고, 길이를 밝히지 않거나 거짓으로 밝힌 본문은 읽는 동안 `MaxBodySize`가 상한에서 끊습니다. 빈 파일은 각
 *   엔드포인트가 따로 거절합니다
 * - 계약에 없는 `Content-Type`은 HttpApi가 평문 415로 응답하므로 Problem Details(`UNSUPPORTED_MEDIA_TYPE`)로 바꿉니다
 */
export const BodyLimit = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const declared = Number(request.headers['content-length'])
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return yield* tooLarge
      const response = yield* httpEffect.pipe(
        Effect.provideService(HttpServerRequest.MaxBodySize, ByteSize.bytes(MAX_BODY_BYTES)),
        Effect.catchDefect((defect) => (isBodyTooLarge(defect) ? tooLarge : Effect.die(defect))),
      )
      if (response.status === 415 && !isJson(response.headers['content-type'])) return yield* unsupported
      return response
    }),
  { global: true },
)

const tooLarge = HttpServerRespondable.toResponse(new FileSizeInvalid({ maxBytes: MAX_BODY_BYTES }))
const unsupported = HttpServerRespondable.toResponse(new UnsupportedMediaType({}))

function isBodyTooLarge(defect: unknown): boolean {
  return (
    defect instanceof HttpServerError.HttpServerError &&
    defect.reason._tag === 'RequestParseError' &&
    defect.reason.reason === 'BodyTooLarge'
  )
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.includes('json') ?? false
}
