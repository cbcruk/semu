import { createHash } from 'node:crypto'
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'

/** 상담 채널 메신저입니다. */
export const MessengerType = Schema.Literals(['KAKAOTALK', 'SLACK'])

/** 연결 전에 보여 줄 채널 정보입니다. */
export const ChannelPreview = Schema.Struct({
  messengerType: MessengerType,
  channelName: Schema.String,
  expiresAt: Schema.String,
})

/** 회사에 연결된 상담 채널입니다. */
export const MessengerChannel = Schema.Struct({
  messengerType: MessengerType,
  channelName: Schema.String,
  connectedAt: Schema.String,
})

/** 상담 채널 응답입니다. */
export type MessengerChannel = typeof MessengerChannel.Type

/** 채널 링크의 토큰입니다. 현행 `?action=chat-integration&token=`의 `token`입니다. */
export const ChannelTokenRequest = Schema.Struct({ token: Schema.NonEmptyString })

/** 저장소가 가진 연결 토큰입니다. 토큰 원문은 저장하지 않고 해시만 둡니다. */
export interface ChannelTokenRecord {
  tokenHash: string
  messengerType: typeof MessengerType.Type
  channelName: string
  expiresAt: number
  usedAt?: number
  usedBy?: Id<'user'>
  companyId?: Id<'company'>
}

/** 토큰을 저장소 키로 바꿉니다. */
export function hashChannelToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 없는 토큰입니다. 현행 `token is invalid`입니다. */
export class ChannelTokenInvalid extends HttpApiError.Problem<ChannelTokenInvalid>()(
  'ChannelTokenInvalid',
  { type: problemType('CHAT_CHANNEL_TOKEN_INVALID'), status: 422, title: 'Channel token is invalid' },
  { code: Schema.tag('CHAT_CHANNEL_TOKEN_INVALID') },
) {}

/** 이미 쓴 토큰입니다. 현행 `token is used`입니다. */
export class ChannelTokenUsed extends HttpApiError.Problem<ChannelTokenUsed>()(
  'ChannelTokenUsed',
  { type: problemType('CHAT_CHANNEL_TOKEN_USED'), status: 422, title: 'Channel token was already used' },
  { code: Schema.tag('CHAT_CHANNEL_TOKEN_USED') },
) {}

/** 만료된 토큰입니다. 현행 `token is expired`입니다. */
export class ChannelTokenExpired extends HttpApiError.Problem<ChannelTokenExpired>()(
  'ChannelTokenExpired',
  { type: problemType('CHAT_CHANNEL_TOKEN_EXPIRED'), status: 422, title: 'Channel token has expired' },
  { code: Schema.tag('CHAT_CHANNEL_TOKEN_EXPIRED') },
) {}

/** 연결 토큰 저장소입니다. 토큰은 메신저 브리지가 발급합니다. */
export class ChannelTokenRepository extends Context.Service<
  ChannelTokenRepository,
  {
    findByHash(tokenHash: string): Effect.Effect<Option.Option<ChannelTokenRecord>>
    listByCompany(companyId: Id<'company'>): Effect.Effect<ChannelTokenRecord[]>
    save(token: ChannelTokenRecord): Effect.Effect<void>
  }
>()('semu/integrations/ChannelTokenRepository') {
  /** `seed`로 시작해 프로세스 메모리에 토큰을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ChannelTokenRecord> = []) =>
    Layer.effect(
      ChannelTokenRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((token) => [token.tokenHash, token])))
        return ChannelTokenRepository.of({
          findByHash: (tokenHash) => Ref.get(store).pipe(Effect.map((all) => Option.fromNullishOr(all.get(tokenHash)))),
          listByCompany: (companyId) =>
            Ref.get(store).pipe(
              Effect.map((all) =>
                [...all.values()]
                  .filter((token) => token.companyId === companyId)
                  .sort((a, b) => (a.usedAt ?? 0) - (b.usedAt ?? 0)),
              ),
            ),
          save: (token) => Ref.update(store, (all) => new Map(all).set(token.tokenHash, token)),
        })
      }),
    )
}
