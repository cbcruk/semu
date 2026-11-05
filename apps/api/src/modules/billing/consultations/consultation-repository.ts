import { Context, Effect, Layer, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { ConsultationRecord } from './consultation.ts'

/** 상담 신청(리드) 저장소입니다. */
export class ConsultationRepository extends Context.Service<
  ConsultationRepository,
  {
    listByCompany(companyId: Id<'company'>): Effect.Effect<ConsultationRecord[]>
    save(consultation: ConsultationRecord): Effect.Effect<void>
  }
>()('semu/billing/ConsultationRepository') {
  /** `seed`로 시작해 프로세스 메모리에 상담 신청을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ConsultationRecord> = []) =>
    Layer.effect(
      ConsultationRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((row) => [row.id, row])))
        return ConsultationRepository.of({
          listByCompany: (companyId) =>
            Ref.get(store).pipe(
              Effect.map((rows) =>
                [...rows.values()]
                  .filter((row) => row.companyId === companyId)
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
              ),
            ),
          save: (consultation) => Ref.update(store, (rows) => new Map(rows).set(consultation.id, consultation)),
        })
      }),
    )
}
