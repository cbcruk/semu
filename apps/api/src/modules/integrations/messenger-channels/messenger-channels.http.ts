import { Clock, Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { requirePermission } from '../access.ts'
import { checkChannelToken } from './channel-token.ts'
import {
  ChannelTokenExpired,
  ChannelTokenInvalid,
  ChannelTokenRepository,
  ChannelTokenUsed,
  hashChannelToken,
} from './messenger-channel.ts'
import type { ChannelTokenRecord, MessengerChannel } from './messenger-channel.ts'

const iso = (millis: number): string => new Date(millis).toISOString()

function channelView(token: ChannelTokenRecord): MessengerChannel {
  return { messengerType: token.messengerType, channelName: token.channelName, connectedAt: iso(token.usedAt ?? 0) }
}

/** 상담 채널 연결 핸들러입니다. */
export const MessengerChannelsHttpLive = HttpApiBuilder.group(
  Api,
  'messengerChannels',
  Effect.fn(function* (handlers) {
    const tokens = yield* ChannelTokenRepository

    const usable = Effect.fn(function* (token: string) {
      const found = yield* tokens.findByHash(hashChannelToken(token))
      const now = yield* Clock.currentTimeMillis
      const stored = Option.getOrUndefined(found)
      const rejection = checkChannelToken(stored, now)
      if (stored === undefined || rejection === 'INVALID') return yield* new ChannelTokenInvalid({})
      if (rejection === 'USED') return yield* new ChannelTokenUsed({})
      if (rejection === 'EXPIRED') return yield* new ChannelTokenExpired({})
      return { token: stored, now }
    })

    return handlers.handleAll({
      preview: ({ payload }) =>
        Effect.gen(function* () {
          yield* requirePermission('messenger-channel:link')
          const { token } = yield* usable(payload.token)
          return { messengerType: token.messengerType, channelName: token.channelName, expiresAt: iso(token.expiresAt) }
        }),
      connect: ({ payload }) =>
        Effect.gen(function* () {
          const actor = yield* requirePermission('messenger-channel:link')
          const { token, now } = yield* usable(payload.token)
          const used: ChannelTokenRecord = { ...token, usedAt: now, usedBy: actor.userId, companyId: actor.companyId }
          yield* tokens.save(used)
          return channelView(used)
        }),
      list: () =>
        requirePermission('messenger-channel:link').pipe(
          Effect.flatMap((actor) => tokens.listByCompany(actor.companyId)),
          Effect.map((found) => ({ items: found.map(channelView) })),
        ),
    })
  }),
)
