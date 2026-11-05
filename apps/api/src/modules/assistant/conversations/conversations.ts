import { Clock, Context, Effect, Layer, Option } from 'effect'
import { paginate } from '../../../shared/http/pagination.ts'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import type { AllowedTool } from '../tools/assistant-tool.types.ts'
import { allowedTools } from '../tools/tool-access.ts'
import { AssistantModel } from './assistant-model.ts'
import { ConversationNotFound, TITLE_LENGTH } from './conversation.ts'
import type {
  AssistantUnavailable,
  Conversation,
  ConversationRecord,
  ConversationSummary,
  Exchange,
  Message,
  ToolProposal,
} from './conversation.ts'
import { ConversationRepository } from './conversation-repository.ts'

/**
 * AI 비서 대화 유스케이스입니다. 권한 확인은 핸들러가 `authorize`로 먼저 합니다.
 *
 * 대화는 만든 사용자만 봅니다. 같은 회사의 다른 사용자나 세무 대리인이 부르면 404입니다.
 */
export class Conversations extends Context.Service<
  Conversations,
  {
    list(actor: Actor, query: PageQuery): Effect.Effect<PageOf<ConversationSummary>>
    get(actor: Actor, conversationId: Id<'conversation'>): Effect.Effect<Conversation, ConversationNotFound>
    /** 첫 메시지로 새 대화를 엽니다. 제목은 첫 메시지 앞 40자입니다. */
    start(actor: Actor, message: string): Effect.Effect<Exchange, AssistantUnavailable>
    send(
      actor: Actor,
      conversationId: Id<'conversation'>,
      message: string,
    ): Effect.Effect<Exchange, ConversationNotFound | AssistantUnavailable>
    remove(actor: Actor, conversationId: Id<'conversation'>): Effect.Effect<void, ConversationNotFound>
    tools(actor: Actor): ReadonlyArray<AllowedTool>
  }
>()('semu/assistant/Conversations') {
  static readonly layer = Layer.effect(
    Conversations,
    Effect.gen(function* () {
      const repository = yield* ConversationRepository
      const model = yield* AssistantModel

      const require = (actor: Actor, conversationId: Id<'conversation'>) =>
        repository
          .find(actor.companyId, actor.userId, conversationId)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new ConversationNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const exchange = Effect.fn(function* (actor: Actor, existing: ConversationRecord | undefined, text: string) {
        const tools = allowedTools(actor)
        const reply = yield* model.reply({
          tools,
          history: (existing?.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
          message: text,
        })
        const millis = yield* Clock.currentTimeMillis
        const now = new Date(millis).toISOString()
        const message: Message = {
          id: newId('message', millis),
          role: 'USER',
          content: text,
          toolProposals: [],
          createdAt: now,
        }
        const answer: Message = {
          id: newId('message', millis),
          role: 'ASSISTANT',
          content: reply.content,
          toolProposals: guardProposals(reply.toolProposals, tools),
          createdAt: now,
        }
        const record: ConversationRecord =
          existing === undefined
            ? {
                id: newId('conversation', millis),
                companyId: actor.companyId,
                userId: actor.userId,
                title: text.slice(0, TITLE_LENGTH),
                createdAt: now,
                updatedAt: now,
                messages: [message, answer],
              }
            : { ...existing, updatedAt: now, messages: [...existing.messages, message, answer] }
        yield* repository.save(record)
        return { conversationId: record.id, message, reply: answer }
      })

      return Conversations.of({
        list: (actor, query) =>
          repository
            .listByUser(actor.companyId, actor.userId)
            .pipe(Effect.map((records) => paginate(records.map(toSummary), descendingKey, query))),
        get: (actor, conversationId) =>
          require(actor, conversationId).pipe(
            Effect.map((record) => ({ ...toSummary(record), messages: record.messages })),
          ),
        start: (actor, message) => exchange(actor, undefined, message),
        send: (actor, conversationId, message) =>
          require(actor, conversationId).pipe(Effect.flatMap((record) => exchange(actor, record, message))),
        remove: (actor, conversationId) =>
          Effect.gen(function* () {
            const record = yield* require(actor, conversationId)
            const millis = yield* Clock.currentTimeMillis
            yield* repository.save({ ...record, deletedAt: new Date(millis).toISOString() })
          }),
        tools: (actor) => allowedTools(actor),
      })
    }),
  )
}

/**
 * 모델 제안을 허용된 도구로 거르고, 쓰기 도구에는 확인을 강제합니다.
 *
 * 모델 출력은 신뢰하지 않습니다. 허용되지 않은 도구를 제안해도 사용자에게 보이지 않습니다.
 */
export function guardProposals(
  proposals: ReadonlyArray<ToolProposal>,
  tools: ReadonlyArray<AllowedTool>,
): ToolProposal[] {
  return proposals.flatMap((proposal) => {
    const allowed = tools.find((tool) => tool.tool === proposal.tool)
    if (allowed === undefined) return []
    return [{ ...proposal, requiresConfirmation: allowed.mode === 'CONFIRM' }]
  })
}

function toSummary(record: ConversationRecord): ConversationSummary {
  return { id: record.id, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt }
}

/** 최근 갱신순 목록의 커서 키입니다. 문자 코드를 뒤집어 오름차순 비교가 최신순이 되게 합니다. */
function descendingKey(summary: ConversationSummary): string {
  return [...`${summary.updatedAt}|${summary.id}`]
    .map((char) => String.fromCharCode(0xffff - char.charCodeAt(0)))
    .join('')
}
