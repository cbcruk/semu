import { Effect, Layer, Option } from 'effect'
import { CompanyDirectory } from '../modules/identity-access/identity-access.public.ts'
import type { DirectoryCompany } from '../modules/identity-access/identity-access.public.ts'
import { CompanyProfiles } from '../modules/integrations/integrations.public.ts'
import type { CertificateCompany } from '../modules/integrations/integrations.public.ts'

/**
 * Integrations의 `CompanyProfiles` 포트를 Identity & Access의 회사(`CompanyDirectory`)로 구현합니다.
 *
 * 인증서 명의 확인과 수집 요청에 사업자번호·사업자 형태·대표자 이름을 줍니다.
 */
export const IntegrationsCompanyProfilesFromIdentityAccess: Layer.Layer<CompanyProfiles, never, CompanyDirectory> =
  Layer.effect(
    CompanyProfiles,
    Effect.gen(function* () {
      const companies = yield* CompanyDirectory
      return CompanyProfiles.of({
        profileOf: (companyId) => companies.find(companyId).pipe(Effect.map(Option.map(certificateCompanyOf))),
      })
    }),
  )

function certificateCompanyOf(company: DirectoryCompany): CertificateCompany {
  return {
    businessType: company.businessType,
    businessNumber: company.businessNumber,
    representativeNames: company.representativeNames,
  }
}
