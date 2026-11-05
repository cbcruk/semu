import { Context, Effect, Layer, Option } from 'effect'
import { makeTenantTable, TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `assistant_conversations` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<ConversationRecord> = []) =>
    Layer.effect(
      ConversationRepository,
      Effect.gen(function* () {
        const table = yield* makeTenantTable<ConversationRecord>('assistant_conversations', seed)
        const visible = (record: ConversationRecord, userId: Id<'user'>): boolean =>
          record.userId === userId && record.deletedAt === undefined
        return ConversationRepository.of({
          find: (companyId, userId, conversationId) =>
            Effect.map(
              table.find(companyId, conversationId),
              Option.filter((record) => visible(record, userId)),
            ),
          listByUser: (companyId, userId) =>
            table
              .list(companyId)
              .pipe(
                Effect.map((records) =>
                  records
                    .filter((record) => visible(record, userId))
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)),
                ),
              ),
          save: (conversation) => table.save(conversation),
        })
      }),
    )

  /** 프로세스 메모리에 대화를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ConversationRecord> = []) =>
    ConversationRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
