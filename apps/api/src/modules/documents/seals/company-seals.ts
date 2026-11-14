import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { decideSealRegistration, decideSealRemoval } from './company-seal.aggregate.ts'
import {
  CompanySealNotFound,
  CompanySealRepository,
  type CompanySeal,
  type CompanySealLimitExceeded,
  type CompanySealRecord,
  type CompanySealRegistration,
} from './company-seal.ts'

const toView = (seal: CompanySealRecord): CompanySeal => ({
  id: seal.id,
  name: seal.name,
  source: seal.source,
  imageFileId: seal.imageFileId,
  createdAt: seal.createdAt,
})

/** 회사 도장 관리입니다. 모두 행위자 회사의 도장만 다룹니다. */
export class CompanySeals extends Context.Service<
  CompanySeals,
  {
    list(actor: Actor): Effect.Effect<CompanySeal[]>
    register(
      actor: Actor,
      input: typeof CompanySealRegistration.Type,
    ): Effect.Effect<CompanySeal, CompanySealLimitExceeded>
    remove(actor: Actor, id: string): Effect.Effect<void, CompanySealNotFound>
  }
>()('semu/documents/CompanySeals') {
  static readonly layer = Layer.effect(
    CompanySeals,
    Effect.gen(function* () {
      const seals = yield* CompanySealRepository
      const active = (actor: Actor) =>
        Effect.map(seals.list(actor.companyId), (all) => all.filter((seal) => seal.deletedAt === undefined))

      return CompanySeals.of({
        list: (actor) => Effect.map(active(actor), (all) => all.map(toView)),

        register: Effect.fn('CompanySeals.register')(function* (actor, input) {
          const activeSeals = yield* active(actor)
          const now = yield* DateTime.now
          const { seal } = yield* Effect.fromResult(
            decideSealRegistration(
              {
                id: newId('companySeal', DateTime.toEpochMillis(now)),
                companyId: actor.companyId,
                name: input.name,
                source: input.source,
                imageFileId: input.imageFileId,
                createdAt: DateTime.formatIso(now),
              },
              activeSeals.length,
            ),
          )
          yield* seals.save(seal)
          return toView(seal)
        }),

        remove: Effect.fn('CompanySeals.remove')(function* (actor, id) {
          const found = yield* seals.find(actor.companyId, id)
          if (Option.isNone(found)) return yield* new CompanySealNotFound({})
          const { seal } = yield* Effect.fromResult(
            decideSealRemoval(found.value, DateTime.formatIso(yield* DateTime.now)),
          )
          yield* seals.save(seal)
        }),
      })
    }),
  )
}
