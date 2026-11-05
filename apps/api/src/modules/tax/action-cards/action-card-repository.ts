import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { ActionCardRecord } from './action-card.ts'

/** 할 일 카드 저장소입니다. 같은 회사·신고 건·종류의 카드는 하나만 있습니다. */
export class ActionCardRepository extends Context.Service<
  ActionCardRepository,
  {
    findById(companyId: Id<'company'>, id: Id<'actionCard'>): Effect.Effect<Option.Option<ActionCardRecord>>
    listByCompany(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<ActionCardRecord>>
    listByFiling(companyId: Id<'company'>, filingId: Id<'filing'>): Effect.Effect<ReadonlyArray<ActionCardRecord>>
    save(card: ActionCardRecord): Effect.Effect<void>
  }
>()('semu/tax/ActionCardRepository') {
  /** `tax_action_cards` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<ActionCardRecord> = []) =>
    Layer.effect(
      ActionCardRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<ActionCardRecord>('tax_action_cards', {
          seed,
          companyOf: (card) => card.companyId,
        })

        return ActionCardRepository.of({
          findById: (companyId, id) =>
            Effect.map(
              table.get(id),
              Option.filter((card) => card.companyId === companyId),
            ),
          listByCompany: (companyId) => table.byCompany(companyId),
          listByFiling: (companyId, filingId) =>
            Effect.map(table.byCompany(companyId), (cards) =>
              cards.filter((card) => card.subject.filingId === filingId),
            ),
          save: (card) => table.put(card),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 카드를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ActionCardRecord> = []) =>
    ActionCardRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
