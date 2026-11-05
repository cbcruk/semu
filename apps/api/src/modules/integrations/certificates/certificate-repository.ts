import { Context, Effect, Layer, Option } from 'effect'
import { makeTenantTable, TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { CertificateRecord } from './certificate.ts'

/** 공동인증서 저장소입니다. 삭제한 인증서도 남겨 연동이 `UNREGISTERED`를 볼 수 있게 합니다. */
export class CertificateRepository extends Context.Service<
  CertificateRepository,
  {
    /** 삭제한 인증서도 돌려줍니다. */
    find(companyId: Id<'company'>, certificateId: Id<'certificate'>): Effect.Effect<Option.Option<CertificateRecord>>
    /** 삭제하지 않은 인증서입니다. */
    listByCompany(companyId: Id<'company'>): Effect.Effect<CertificateRecord[]>
    findBySerial(companyId: Id<'company'>, serialNumber: string): Effect.Effect<Option.Option<CertificateRecord>>
    save(certificate: CertificateRecord): Effect.Effect<void>
  }
>()('semu/integrations/CertificateRepository') {
  /** `integrations_certificates` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<CertificateRecord> = []) =>
    Layer.effect(
      CertificateRepository,
      Effect.gen(function* () {
        const table = yield* makeTenantTable<CertificateRecord>('integrations_certificates', seed)
        const active = (companyId: Id<'company'>) =>
          table
            .list(companyId)
            .pipe(
              Effect.map((all) =>
                all
                  .filter((found) => found.deletedAt === undefined)
                  .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id)),
              ),
            )
        return CertificateRepository.of({
          find: (companyId, certificateId) => table.find(companyId, certificateId),
          listByCompany: active,
          findBySerial: (companyId, serialNumber) =>
            active(companyId).pipe(
              Effect.map((list) => Option.fromNullishOr(list.find((found) => found.serialNumber === serialNumber))),
            ),
          save: (certificate) => table.save(certificate),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 인증서를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<CertificateRecord> = []) =>
    CertificateRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
