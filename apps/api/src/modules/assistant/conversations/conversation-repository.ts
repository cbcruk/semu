import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { ConversationRecord } from './conversation.ts'

/** 대화 저장소입니다. 지운 대화도 보관하고 조회에서만 뺍니다. */
export class ConversationRepository extends Context.Service<
  ConversationRepository,
  {
    /** 지우지 않은 대화를 사용자 범위에서 찾습니다. */
    find(
      companyId: Id<'company'>,
      userId: Id<'user'>,
      conversationId: Id<'conversation'>,
    ): Effect.Effect<Option.Option<ConversationRecord>>
    /** 지우지 않은 대화를 최근 갱신순으로 돌려줍니다. */
    listByUser(companyId: Id<'company'>, userId: Id<'user'>): Effect.Effect<ConversationRecord[]>
    save(conversation: ConversationRecord): Effect.Effect<void>
  }
>()('semu/assistant/ConversationRepository') {
  /** 프로세스 메모리에 대화를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ConversationRecord> = []) =>
    Layer.effect(
      ConversationRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((conversation) => [conversation.id, conversation])))
        const visible = (record: ConversationRecord, companyId: Id<'company'>, userId: Id<'user'>): boolean =>
          record.companyId === companyId && record.userId === userId && record.deletedAt === undefined
        return ConversationRepository.of({
          find: (companyId, userId, conversationId) =>
            Ref.get(store).pipe(
              Effect.map((records) =>
                Option.filter(Option.fromNullishOr(records.get(conversationId)), (r) => visible(r, companyId, userId)),
              ),
            ),
          listByUser: (companyId, userId) =>
            Ref.get(store).pipe(
              Effect.map((records) =>
                [...records.values()]
                  .filter((record) => visible(record, companyId, userId))
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)),
              ),
            ),
          save: (conversation) => Ref.update(store, (records) => new Map(records).set(conversation.id, conversation)),
        })
      }),
    )
}
