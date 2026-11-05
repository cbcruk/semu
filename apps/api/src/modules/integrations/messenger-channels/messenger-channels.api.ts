import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { PermissionDenied } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import {
  ChannelPreview,
  ChannelTokenExpired,
  ChannelTokenInvalid,
  ChannelTokenRequest,
  ChannelTokenUsed,
  MessengerChannel,
} from './messenger-channel.ts'

const tokenErrors = [PermissionDenied, ChannelTokenInvalid, ChannelTokenUsed, ChannelTokenExpired] as const

/**
 * 카카오톡·슬랙 상담 채널 연결입니다. 현행 sf `/api/member/chat-channel/`을 대신합니다.
 *
 * 연결할 회사는 토큰의 회사(지금 로그인한 회사)입니다. 다른 회사로 연결하려면 회사를 전환한 뒤 연결합니다.
 */
export class MessengerChannelsApi extends HttpApiGroup.make('messengerChannels')
  .add(
    HttpApiEndpoint.post('preview', '/messenger-channels::preview', {
      payload: ChannelTokenRequest,
      success: ChannelPreview,
      error: tokenErrors,
    }),
    HttpApiEndpoint.post('connect', '/messenger-channels', {
      payload: ChannelTokenRequest,
      success: MessengerChannel.pipe(HttpApiSchema.status(201)),
      error: tokenErrors,
    }),
    HttpApiEndpoint.get('list', '/messenger-channels', {
      success: Schema.Struct({ items: Schema.Array(MessengerChannel) }),
      error: PermissionDenied,
    }),
  )
  .middleware(Authentication) {}
