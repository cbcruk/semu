import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { testActor } from '../../identity-access/testing.ts'
import { AssistantModel } from './assistant-model.ts'
import { ConversationRepository } from './conversation-repository.ts'
import { Conversations, guardProposals } from './conversations.ts'

/** 허용 여부와 상관없이 모든 쓰기 도구를 확인 없이 실행하겠다고 답하는 모델입니다. */
const recklessModel = Layer.succeed(
  AssistantModel,
  AssistantModel.of({
    reply: () =>
      Effect.succeed({
        content: '처리했습니다.',
        toolProposals: [
          { tool: 'ISSUE_TAX_INVOICE', arguments: {}, requiresConfirmation: false },
          { tool: 'LOOKUP_PAYROLL', arguments: {}, requiresConfirmation: false },
        ],
      }),
  }),
)

const run = <A, E>(
  effect: Effect.Effect<A, E, Conversations>,
  model: Layer.Layer<AssistantModel> = AssistantModel.layerFake,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(Effect.provide(Conversations.layer.pipe(Layer.provide([ConversationRepository.layerMemory(), model])))),
  )

describe('도구 제안 거르기', () => {
  it('행위자가 쓸 수 없는 도구는 빼고 쓰기 도구는 사용자 확인을 거치게 합니다', () => {
    const guarded = guardProposals(
      [
        { tool: 'ISSUE_TAX_INVOICE', arguments: {}, requiresConfirmation: false },
        { tool: 'LOOKUP_PAYROLL', arguments: {}, requiresConfirmation: false },
      ],
      [{ tool: 'ISSUE_TAX_INVOICE', mode: 'CONFIRM' }],
    )

    expect(guarded).toEqual([{ tool: 'ISSUE_TAX_INVOICE', arguments: {}, requiresConfirmation: true }])
  })
})

describe('대화 서비스', () => {
  it('모델이 행위자에게 허용되지 않은 도구를 제안해도 보여 주지 않습니다', async () => {
    const freeAdmin = testActor({ plans: new Set() })

    const exchange = await run(
      Effect.flatMap(Conversations, (service) => service.start(freeAdmin, '세금계산서 발행해 줘')),
      recklessModel,
    )

    expect(exchange.reply.toolProposals).toEqual([
      { tool: 'ISSUE_TAX_INVOICE', arguments: {}, requiresConfirmation: true },
    ])
  })

  it('대화는 시작한 사용자만 봅니다', async () => {
    const owner = testActor()
    const colleague = testActor({ userId: 'usr_01JBQ000000000000000000002' as Id<'user'> })

    const result = await run(
      Effect.gen(function* () {
        const service = yield* Conversations
        const { conversationId } = yield* service.start(owner, '부가세 신고 기한이 언제인가요?')
        const mine = yield* service.list(owner, {})
        const theirs = yield* service.list(colleague, {})
        const peek = yield* Effect.flip(service.get(colleague, conversationId))
        return { mine: mine.items.length, theirs: theirs.items.length, peek: peek._tag }
      }),
    )

    expect(result).toEqual({ mine: 1, theirs: 0, peek: 'ConversationNotFound' })
  })

  it('여러 페이지에 걸쳐 가장 최근에 바뀐 대화부터 보여 줍니다', async () => {
    const actor = testActor()

    const pages = await run(
      Effect.gen(function* () {
        const service = yield* Conversations
        const first = yield* service.start(actor, '첫 대화')
        yield* Effect.sleep('5 millis')
        yield* service.start(actor, '둘째 대화')
        yield* Effect.sleep('5 millis')
        yield* service.send(actor, first.conversationId, '이어서 질문')
        const page1 = yield* service.list(actor, { limit: 1 })
        const page2 = yield* service.list(actor, {
          limit: 1,
          ...(page1.nextCursor ? { cursor: page1.nextCursor } : {}),
        })
        return [page1.items[0]?.title, page2.items[0]?.title, page2.nextCursor]
      }),
    )

    expect(pages).toEqual(['첫 대화', '둘째 대화', undefined])
  })
})
