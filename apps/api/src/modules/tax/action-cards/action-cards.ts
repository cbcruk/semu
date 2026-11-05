import { Context, Effect, Layer, Option } from 'effect'
import { paginate } from '../../../shared/http/pagination.ts'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { hasPermission } from '../../identity-access/actor.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import type { FilingRecord } from '../filings/filing.types.ts'
import { currentInstant, descendingKey } from '../tax-time.ts'
import {
  compareClosedCards,
  compareOpenCards,
  completedCardStatus,
  filingCardEffects,
  openCardState,
} from './action-card-rules.ts'
import type { ActionCardCompletion, ActionCardKind, FilingCardTrigger } from './action-card-rules.types.ts'
import { ActionCardClosed, ActionCardNotFound } from './action-card.ts'
import type { ActionCard, ActionCardRecord } from './action-card.ts'
import { ActionCardRepository } from './action-card-repository.ts'

/** 할 일 카드 목록의 탭입니다. `CLOSED`는 완료·기한 경과 카드입니다. */
export type ActionCardTab = 'OPEN' | 'CLOSED'

/** 신고 건 카드를 보는 데 필요한 요건입니다. 세무 메뉴와 같습니다. */
const FILING_CARD_REQUIRES: ActionCardRecord['requires'] = { permission: 'filing:read', plans: ['TAXATION'] }

/** 홈의 할 일 카드 작업입니다. 카드 생성·마감은 신고 건 전이가 같은 요청에서 부릅니다. */
export class ActionCards extends Context.Service<
  ActionCards,
  {
    /** 행위자가 볼 수 있는 카드 한 탭입니다. 진행중은 마감일 순, 완료는 최근 순입니다. */
    list(actor: Actor, tab: ActionCardTab, query: PageQuery): Effect.Effect<PageOf<ActionCard>>
    summary(actor: Actor): Effect.Effect<{ openCount: number; closedCount: number; nearestDueDate: string | null }>
    /** 사용자가 카드를 닫습니다. 넘어가기는 마감일이 지났으면 `SKIPPED_OVERDUE`가 됩니다. */
    complete(
      actor: Actor,
      id: Id<'actionCard'>,
      completion: ActionCardCompletion,
    ): Effect.Effect<ActionCard, ActionCardNotFound | ActionCardClosed>
    /** 신고 건 전이 하나의 카드 효과를 적용합니다. `filing`은 전이를 적용한 뒤의 값입니다. */
    applyFilingTrigger(filing: FilingRecord, trigger: FilingCardTrigger, now: string): Effect.Effect<void>
    /** 고객이 신고서·고지서를 처음 열었을 때 결과 확인 카드를 닫습니다. */
    closeFilingCard(filing: FilingRecord, kind: ActionCardKind, now: string): Effect.Effect<void>
  }
>()('semu/tax/ActionCards') {
  static readonly layer = Layer.effect(
    ActionCards,
    Effect.gen(function* () {
      const repository = yield* ActionCardRepository

      const visibleCards = (actor: Actor) =>
        repository
          .listByCompany(actor.companyId)
          .pipe(Effect.map((cards) => cards.filter((card) => canSee(actor, card))))

      const closeBySystem = (card: ActionCardRecord, now: string) =>
        card.status === 'OPEN' ? repository.save({ ...card, status: 'DONE', completedAt: now }) : Effect.void

      const applyFilingTrigger = Effect.fn('ActionCards.applyFilingTrigger')(function* (
        filing: FilingRecord,
        trigger: FilingCardTrigger,
        now: string,
      ) {
        const cards = yield* repository.listByFiling(filing.companyId, filing.id)
        for (const effect of filingCardEffects(trigger, filing)) {
          if (effect.op === 'CLOSE_ALL') {
            yield* Effect.forEach(cards, (card) => closeBySystem(card, now), { discard: true })
            continue
          }
          const existing = cards.find((card) => card.kind === effect.kind)
          if (effect.op === 'CLOSE') {
            if (existing !== undefined) yield* closeBySystem(existing, now)
            continue
          }
          yield* repository.save({
            ...(existing ?? newFilingCard(filing, effect.kind, now)),
            ...openCardState(existing, effect.dueDate),
          })
        }
      })

      const closeFilingCard = Effect.fn('ActionCards.closeFilingCard')(function* (
        filing: FilingRecord,
        kind: ActionCardKind,
        now: string,
      ) {
        const cards = yield* repository.listByFiling(filing.companyId, filing.id)
        const card = cards.find((candidate) => candidate.kind === kind)
        if (card !== undefined) yield* closeBySystem(card, now)
      })

      const list = Effect.fn('ActionCards.list')(function* (actor: Actor, tab: ActionCardTab, query: PageQuery) {
        const cards = yield* visibleCards(actor)
        const page =
          tab === 'OPEN'
            ? paginate(
                cards.filter((card) => card.status === 'OPEN').sort(compareOpenCards),
                (card) => `${card.dueDate ?? '9999-12-31'}|${card.createdAt}|${card.id}`,
                query,
              )
            : paginate(
                cards.filter((card) => card.status !== 'OPEN').sort(compareClosedCards),
                (card) => `${descendingKey(card.completedAt ?? '')}|${descendingKey(card.id)}`,
                query,
              )
        return { ...page, items: page.items.map(toActionCard) }
      })

      const summary = Effect.fn('ActionCards.summary')(function* (actor: Actor) {
        const cards = yield* visibleCards(actor)
        const open = cards.filter((card) => card.status === 'OPEN')
        const dueDates = open.flatMap((card) => (card.dueDate === null ? [] : [card.dueDate])).sort()
        return { openCount: open.length, closedCount: cards.length - open.length, nearestDueDate: dueDates[0] ?? null }
      })

      const complete = Effect.fn('ActionCards.complete')(function* (
        actor: Actor,
        id: Id<'actionCard'>,
        completion: ActionCardCompletion,
      ) {
        const card = yield* repository
          .findById(actor.companyId, id)
          .pipe(
            Effect.map(Option.filter((found) => canSee(actor, found))),
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new ActionCardNotFound({})), onSome: Effect.succeed }),
            ),
          )
        if (card.status !== 'OPEN') return yield* new ActionCardClosed({ currentStatus: card.status })
        const { now, today } = yield* currentInstant
        const next: ActionCardRecord = {
          ...card,
          status: completedCardStatus(completion, card.dueDate, today),
          completedAt: now,
        }
        yield* repository.save(next)
        return toActionCard(next)
      })

      return ActionCards.of({ list, summary, complete, applyFilingTrigger, closeFilingCard })
    }),
  )
}

function canSee(actor: Actor, card: ActionCardRecord): boolean {
  const plans = card.requires.plans
  return (
    hasPermission(actor, card.requires.permission) &&
    (plans.length === 0 || plans.some((plan) => actor.plans.has(plan)))
  )
}

function newFilingCard(filing: FilingRecord, kind: ActionCardKind, now: string): ActionCardRecord {
  return {
    id: newId('actionCard'),
    companyId: filing.companyId,
    kind,
    status: 'OPEN',
    subject: {
      type: 'FILING',
      filingId: filing.id,
      taxType: filing.taxType,
      filingKind: filing.kind,
      periodKey: filing.periodKey,
    },
    requires: FILING_CARD_REQUIRES,
    dueDate: null,
    reopenCount: 0,
    createdAt: now,
    completedAt: null,
  }
}

function toActionCard(card: ActionCardRecord): ActionCard {
  const { companyId: _, requires: __, ...rest } = card
  return rest
}
