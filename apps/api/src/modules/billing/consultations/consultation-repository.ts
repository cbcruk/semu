import { Context, Effect, Layer } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `billing_consultations` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<ConsultationRecord> = []) =>
    Layer.effect(
      ConsultationRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<ConsultationRecord>('billing_consultations', {
          seed,
          companyOf: (row) => row.companyId,
        })
        return ConsultationRepository.of({
          listByCompany: (companyId) =>
            Effect.map(table.byCompany(companyId), (rows) =>
              rows.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
            ),
          save: (consultation) => table.put(consultation),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 상담 신청을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ConsultationRecord> = []) =>
    ConsultationRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
