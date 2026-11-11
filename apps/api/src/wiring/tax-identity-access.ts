import { Effect, Layer, Option } from 'effect'
import { CompanyDirectory, CompanyPlans } from '../modules/identity-access/identity-access.public.ts'
import type { DirectoryCompany } from '../modules/identity-access/identity-access.public.ts'
import { TaxCompanies } from '../modules/tax/tax.public.ts'
import type { TaxCompany } from '../modules/tax/tax.public.ts'

/**
 * Tax의 `TaxCompanies` 포트를 Identity & Access의 회사(`CompanyDirectory`)와 Billing이 구현한 플랜(`CompanyPlans`)으로 구현합니다.
 *
 * 사업자 형태는 회사에서, 플랜은 구독에서 읽습니다. 결산월·원천세 주기 같은 세무 설정은 Tax가 자기 저장소(`tax_settings`)에서
 * 읽어 Tax 안에서 합치므로 이 어댑터는 모릅니다.
 */
export const TaxCompaniesFromIdentityAccess: Layer.Layer<TaxCompanies, never, CompanyDirectory | CompanyPlans> =
  Layer.effect(
    TaxCompanies,
    Effect.gen(function* () {
      const companies = yield* CompanyDirectory
      const plans = yield* CompanyPlans

      const companyOf = (company: DirectoryCompany): Effect.Effect<TaxCompany> =>
        plans.plansOf(company.id).pipe(
          Effect.map((active) => ({
            companyId: company.id,
            businessType: company.businessType,
            plans: [...active].toSorted(),
          })),
        )

      return TaxCompanies.of({
        get: (companyId) =>
          companies.find(companyId).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(Option.none<TaxCompany>()),
                onSome: (company) => companyOf(company).pipe(Effect.map(Option.some)),
              }),
            ),
          ),
        listTaxation: () =>
          companies.list().pipe(
            Effect.flatMap((all) => Effect.forEach(all, companyOf)),
            Effect.map((all) => all.filter((company) => company.plans.includes('TAXATION'))),
          ),
      })
    }),
  )
