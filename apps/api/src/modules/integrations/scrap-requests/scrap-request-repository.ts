import { Context, Effect, Layer, Option, Ref } from 'effect'
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
  /** `seed`로 시작해 프로세스 메모리에 수집 요청을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ScrapRequestRecord> = []) =>
    Layer.effect(
      ScrapRequestRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((request) => [request.id, request])))
        const list = (companyId: Id<'company'>, type?: InstitutionType) =>
          Ref.get(store).pipe(
            Effect.map((all) =>
              [...all.values()]
                .filter(
                  (found) => found.companyId === companyId && (type === undefined || found.institutionType === type),
                )
                .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)),
            ),
          )
        return ScrapRequestRepository.of({
          find: (companyId, requestId) =>
            Ref.get(store).pipe(
              Effect.map((all) =>
                Option.filter(Option.fromNullishOr(all.get(requestId)), (found) => found.companyId === companyId),
              ),
            ),
          listByCompany: list,
          latest: (companyId, type) =>
            list(companyId, type).pipe(Effect.map((found) => Option.fromNullishOr(found[0]))),
          findByIdempotencyKey: (companyId, key) =>
            list(companyId).pipe(
              Effect.map((found) => Option.fromNullishOr(found.find((request) => request.idempotencyKey === key))),
            ),
          save: (request) => Ref.update(store, (all) => new Map(all).set(request.id, request)),
        })
      }),
    )
}
