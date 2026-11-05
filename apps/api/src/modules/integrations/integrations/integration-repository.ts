import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { InstitutionType } from '../institutions/institution.ts'
import type { IntegrationRecord } from './integration.ts'

/** 기관 연동 저장소입니다. */
export class IntegrationRepository extends Context.Service<
  IntegrationRepository,
  {
    find(companyId: Id<'company'>, integrationId: Id<'integration'>): Effect.Effect<Option.Option<IntegrationRecord>>
    listByCompany(companyId: Id<'company'>, type?: InstitutionType): Effect.Effect<IntegrationRecord[]>
    save(integration: IntegrationRecord): Effect.Effect<void>
    remove(companyId: Id<'company'>, integrationId: Id<'integration'>): Effect.Effect<void>
  }
>()('semu/integrations/IntegrationRepository') {
  /** `seed`로 시작해 프로세스 메모리에 연동을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<IntegrationRecord> = []) =>
    Layer.effect(
      IntegrationRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((integration) => [integration.id, integration])))
        return IntegrationRepository.of({
          find: (companyId, integrationId) =>
            Ref.get(store).pipe(
              Effect.map((all) =>
                Option.filter(Option.fromNullishOr(all.get(integrationId)), (found) => found.companyId === companyId),
              ),
            ),
          listByCompany: (companyId, type) =>
            Ref.get(store).pipe(
              Effect.map((all) =>
                [...all.values()]
                  .filter((found) => found.companyId === companyId && (type === undefined || found.type === type))
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
              ),
            ),
          save: (integration) => Ref.update(store, (all) => new Map(all).set(integration.id, integration)),
          remove: (companyId, integrationId) =>
            Ref.update(store, (all) => {
              if (all.get(integrationId)?.companyId !== companyId) return all
              const next = new Map(all)
              next.delete(integrationId)
              return next
            }),
        })
      }),
    )
}
