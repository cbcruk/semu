import { Context, Effect, Layer, Option, Ref } from 'effect'
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
  /** `seed`로 시작해 프로세스 메모리에 카드를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ActionCardRecord> = []) =>
    Layer.effect(
      ActionCardRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((card) => [card.id, card])))
        const all = Ref.get(store).pipe(Effect.map((cards) => [...cards.values()]))

        return ActionCardRepository.of({
          findById: (companyId, id) =>
            Ref.get(store).pipe(
              Effect.map((cards) =>
                Option.fromNullishOr(cards.get(id)).pipe(Option.filter((card) => card.companyId === companyId)),
              ),
            ),
          listByCompany: (companyId) =>
            all.pipe(Effect.map((cards) => cards.filter((card) => card.companyId === companyId))),
          listByFiling: (companyId, filingId) =>
            all.pipe(
              Effect.map((cards) =>
                cards.filter((card) => card.companyId === companyId && card.subject.filingId === filingId),
              ),
            ),
          save: (card) => Ref.update(store, (cards) => new Map(cards).set(card.id, card)),
        })
      }),
    )
}
