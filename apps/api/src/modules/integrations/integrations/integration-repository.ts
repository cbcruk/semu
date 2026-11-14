import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory, tenantTableOf } from '../../../shared/persistence/record-table.ts'
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
    /** 그 기관 종류의 연동이 있는 회사입니다. 회사를 건너 읽으므로 정기 수집 작업만 씁니다. */
    companiesWith(type: InstitutionType): Effect.Effect<Id<'company'>[]>
  }
>()('semu/integrations/IntegrationRepository') {
  /** `integrations_integrations` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<IntegrationRecord> = []) =>
    Layer.effect(
      IntegrationRepository,
      Effect.gen(function* () {
        const records = yield* (yield* TableFactory).make<IntegrationRecord>('integrations_integrations', {
          seed,
          companyOf: (record) => record.companyId,
        })
        const table = tenantTableOf(records)
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
          companiesWith: (type) =>
            records
              .all()
              .pipe(
                Effect.map((all) => [
                  ...new Set(all.filter((record) => record.type === type).map((record) => record.companyId)),
                ]),
              ),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 연동을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<IntegrationRecord> = []) =>
    IntegrationRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
