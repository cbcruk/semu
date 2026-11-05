import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import {
  AllowedToolSchema,
  AssistantUnavailable,
  Conversation,
  ConversationId,
  ConversationNotFound,
  ConversationSummary,
  Exchange,
  MessageInput,
} from './conversation.ts'

const accessErrors = [PermissionDenied, EntitlementRequired, TermsReagreementRequired] as const
const params = Schema.Struct({ conversationId: ConversationId })

/**
 * AI 비서 대화입니다. 현행 `/api/company/:id/ai-agent/{conversations,messages}`입니다.
 *
 * 대화는 만든 사용자만 봅니다. 쓰기 도구는 제안만 하고, 실행은 클라이언트가 확인을 받은 뒤 해당 컨텍스트의 API로 합니다.
 */
export class ConversationsApi extends HttpApiGroup.make('conversations')
  .add(
    HttpApiEndpoint.get('listTools', '/assistant-tools', {
      success: Schema.Struct({ items: Schema.Array(AllowedToolSchema) }),
      error: accessErrors,
    }),
    HttpApiEndpoint.get('list', '/conversations', {
      query: Schema.Struct(PageQueryFields),
      success: Page(ConversationSummary),
      error: accessErrors,
    }),
    HttpApiEndpoint.post('start', '/conversations', {
      payload: MessageInput,
      success: Exchange.pipe(HttpApiSchema.status(201)),
      error: [...accessErrors, AssistantUnavailable],
    }),
    HttpApiEndpoint.get('get', '/conversations/:conversationId', {
      params,
      success: Conversation,
      error: [...accessErrors, ConversationNotFound],
    }),
    HttpApiEndpoint.post('send', '/conversations/:conversationId/messages', {
      params,
      payload: MessageInput,
      success: Exchange.pipe(HttpApiSchema.status(201)),
      error: [...accessErrors, ConversationNotFound, AssistantUnavailable],
    }),
    HttpApiEndpoint.delete('remove', '/conversations/:conversationId', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...accessErrors, ConversationNotFound],
    }),
  )
  .middleware(Authentication) {}
