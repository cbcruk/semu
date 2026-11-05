import { Context, Effect, Layer, Option } from 'effect'
import { makeTenantTable, TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `integrations_integrations` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<IntegrationRecord> = []) =>
    Layer.effect(
      IntegrationRepository,
      Effect.gen(function* () {
        const table = yield* makeTenantTable<IntegrationRecord>('integrations_integrations', seed)
        return IntegrationRepository.of({
          find: (companyId, integrationId) => table.find(companyId, integrationId),
          listByCompany: (companyId, type) =>
            table
              .list(companyId)
              .pipe(
                Effect.map((all) =>
                  all
                    .filter((found) => type === undefined || found.type === type)
                    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
                ),
              ),
          save: (integration) => table.save(integration),
          remove: (companyId, integrationId) => table.remove(companyId, integrationId),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 연동을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<IntegrationRecord> = []) =>
    IntegrationRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
