import { Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { CertificateCompany } from '../certificates/certificate-eligibility.types.ts'

/**
 * 인증서 명의 확인과 수집 요청에 필요한 회사 정보(사업자번호·사업자 형태·대표자 이름)를 읽는 포트입니다.
 *
 * 회사의 주인은 Identity & Access입니다. 그쪽이 이 포트를 구현한 Layer를 내보내고 `app.ts`에서 연결합니다.
 */
export class CompanyProfiles extends Context.Service<
  CompanyProfiles,
  {
    profileOf(companyId: Id<'company'>): Effect.Effect<Option.Option<CertificateCompany>>
  }
>()('semu/integrations/CompanyProfiles') {
  /** 고정된 회사 표입니다. */
  static readonly layerMemory = (seed: Iterable<readonly [Id<'company'>, CertificateCompany]> = []) => {
    const profiles = new Map(seed)
    return Layer.succeed(
      CompanyProfiles,
      CompanyProfiles.of({ profileOf: (companyId) => Effect.succeed(Option.fromNullishOr(profiles.get(companyId))) }),
    )
  }
}
