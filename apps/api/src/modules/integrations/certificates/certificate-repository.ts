import { Context, Effect, Layer, Option, Ref } from 'effect'
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
  /** `seed`로 시작해 프로세스 메모리에 인증서를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<CertificateRecord> = []) =>
    Layer.effect(
      CertificateRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((certificate) => [certificate.id, certificate])))
        const active = (companyId: Id<'company'>) =>
          Ref.get(store).pipe(
            Effect.map((all) =>
              [...all.values()]
                .filter((found) => found.companyId === companyId && found.deletedAt === undefined)
                .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id)),
            ),
          )
        return CertificateRepository.of({
          find: (companyId, certificateId) =>
            Ref.get(store).pipe(
              Effect.map((all) =>
                Option.filter(Option.fromNullishOr(all.get(certificateId)), (found) => found.companyId === companyId),
              ),
            ),
          listByCompany: active,
          findBySerial: (companyId, serialNumber) =>
            active(companyId).pipe(
              Effect.map((list) => Option.fromNullishOr(list.find((found) => found.serialNumber === serialNumber))),
            ),
          save: (certificate) => Ref.update(store, (all) => new Map(all).set(certificate.id, certificate)),
        })
      }),
    )
}
