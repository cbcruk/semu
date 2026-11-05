import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import type { AccessRequirement } from '../../identity-access/authorization.ts'

/** 비서 진입 요건입니다. 매뉴얼대로 시스템 관리자가 아니어도 모든 사용자가 씁니다. 쓸 수 있는 도구는 따로 고릅니다. */
export const ASSISTANT_ENTRY: AccessRequirement = { permission: 'conversation:create', requiresTerms: true }

/** 메시지 한 건의 최대 글자 수입니다. */
export const MAX_MESSAGE_LENGTH = 4000

/** 대화 제목으로 쓰는 첫 메시지 앞부분의 글자 수입니다. */
export const TITLE_LENGTH = 40

/** 대화 ID입니다. */
export const ConversationId = IdSchema('conversation')

/** 비서 도구입니다. */
export const AssistantToolSchema = Schema.Literals([
  'KNOWLEDGE_QA',
  'FINANCE_SUMMARY',
  'ISSUE_TAX_INVOICE',
  'REQUEST_CERTIFICATE',
  'LOOKUP_PAYROLL',
])

/** 도구 동작 방식입니다. `CONFIRM`은 사용자가 확인한 뒤 일반 API로 실행합니다. */
export const ToolModeSchema = Schema.Literals(['READ', 'CONFIRM'])

/** 이 행위자가 쓸 수 있는 도구입니다. */
export const AllowedToolSchema = Schema.Struct({ tool: AssistantToolSchema, mode: ToolModeSchema })

/**
 * 비서가 제안한 도구 호출입니다. 비서는 쓰기 도구를 실행하지 않습니다.
 *
 * `requiresConfirmation`이면 클라이언트가 사용자 확인을 받은 뒤 `arguments`로 해당 컨텍스트의 일반 API를 부릅니다.
 * 그래서 실행의 권한·멱등성·감사 로그가 일반 요청과 같습니다.
 */
export const ToolProposal = Schema.Struct({
  tool: AssistantToolSchema,
  arguments: Schema.Record(Schema.String, Schema.Unknown),
  requiresConfirmation: Schema.Boolean,
})
export type ToolProposal = typeof ToolProposal.Type

/** 메시지 작성자입니다. */
export const MessageRole = Schema.Literals(['USER', 'ASSISTANT'])

/** 대화 메시지입니다. */
export const Message = Schema.Struct({
  id: IdSchema('message'),
  role: MessageRole,
  content: Schema.String,
  toolProposals: Schema.Array(ToolProposal),
  createdAt: Schema.String,
})
export type Message = typeof Message.Type

/** 대화 목록 항목입니다. */
export const ConversationSummary = Schema.Struct({
  id: ConversationId,
  title: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type ConversationSummary = typeof ConversationSummary.Type

/** 대화 상세입니다. 메시지를 오래된 순으로 담습니다. */
export const Conversation = Schema.Struct({
  ...ConversationSummary.fields,
  messages: Schema.Array(Message),
})
export type Conversation = typeof Conversation.Type

/** 사용자가 보내는 메시지입니다. */
export const MessageInput = Schema.Struct({
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_MESSAGE_LENGTH)),
})

/** 메시지 하나를 보낸 결과입니다. 보낸 메시지와 비서 답을 함께 돌려줍니다. */
export const Exchange = Schema.Struct({
  conversationId: ConversationId,
  message: Message,
  reply: Message,
})
export type Exchange = typeof Exchange.Type

/** 저장된 대화입니다. 대화는 만든 사용자만 봅니다. */
export interface ConversationRecord {
  id: Id<'conversation'>
  companyId: Id<'company'>
  userId: Id<'user'>
  title: string
  createdAt: string
  updatedAt: string
  messages: Message[]
  deletedAt?: string
}

/** 대화가 없거나, 다른 사용자의 것이거나, 지운 대화입니다. */
export class ConversationNotFound extends HttpApiError.Problem<ConversationNotFound>()(
  'ConversationNotFound',
  { type: problemType('CONVERSATION_NOT_FOUND'), status: 404, title: 'Conversation not found' },
  { code: Schema.tag('CONVERSATION_NOT_FOUND') },
) {}

/** 언어 모델이 응답하지 않았습니다. 메시지는 저장하지 않았으니 다시 보내면 됩니다. */
export class AssistantUnavailable extends HttpApiError.Problem<AssistantUnavailable>()(
  'AssistantUnavailable',
  { type: problemType('ASSISTANT_UNAVAILABLE'), status: 503, title: 'Assistant is unavailable' },
  { code: Schema.tag('ASSISTANT_UNAVAILABLE') },
) {}
