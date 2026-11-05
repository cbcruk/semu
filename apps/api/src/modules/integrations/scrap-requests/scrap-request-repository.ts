import { Context, Effect, Layer, Option } from 'effect'
import { makeTenantTable, TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { InstitutionType } from '../institutions/institution.ts'
import type { ScrapRequestRecord } from './scrap-request.ts'

/** 수집 요청 저장소입니다. */
export class ScrapRequestRepository extends Context.Service<
  ScrapRequestRepository,
  {
    find(companyId: Id<'company'>, requestId: Id<'scrapRequest'>): Effect.Effect<Option.Option<ScrapRequestRecord>>
    /** 최근 요청부터 돌려줍니다. */
    listByCompany(companyId: Id<'company'>, type?: InstitutionType): Effect.Effect<ScrapRequestRecord[]>
    /** 그 기관의 가장 최근 요청입니다. 쿨다운 판정에 씁니다. */
    latest(companyId: Id<'company'>, type: InstitutionType): Effect.Effect<Option.Option<ScrapRequestRecord>>
    findByIdempotencyKey(companyId: Id<'company'>, key: string): Effect.Effect<Option.Option<ScrapRequestRecord>>
    save(request: ScrapRequestRecord): Effect.Effect<void>
  }
>()('semu/integrations/ScrapRequestRepository') {
  /** `integrations_scrap_requests` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<ScrapRequestRecord> = []) =>
    Layer.effect(
      ScrapRequestRepository,
      Effect.gen(function* () {
        const table = yield* makeTenantTable<ScrapRequestRecord>('integrations_scrap_requests', seed)
        const list = (companyId: Id<'company'>, type?: InstitutionType) =>
          table
            .list(companyId)
            .pipe(
              Effect.map((all) =>
                all
                  .filter((found) => type === undefined || found.institutionType === type)
                  .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)),
              ),
            )
        return ScrapRequestRepository.of({
          find: (companyId, requestId) => table.find(companyId, requestId),
          listByCompany: list,
          latest: (companyId, type) =>
            list(companyId, type).pipe(Effect.map((found) => Option.fromNullishOr(found[0]))),
          findByIdempotencyKey: (companyId, key) =>
            list(companyId).pipe(
              Effect.map((found) => Option.fromNullishOr(found.find((request) => request.idempotencyKey === key))),
            ),
          save: (request) => table.save(request),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 수집 요청을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ScrapRequestRecord> = []) =>
    ScrapRequestRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
