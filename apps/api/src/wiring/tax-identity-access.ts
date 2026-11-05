import { Effect, Layer, Option } from 'effect'
import { CompanyDirectory, CompanyPlans } from '../modules/identity-access/identity-access.public.ts'
import type { DirectoryCompany } from '../modules/identity-access/identity-access.public.ts'
import { TaxProfiles } from '../modules/tax/tax.public.ts'
import type { TaxProfile } from '../modules/tax/tax.public.ts'

/**
 * Tax가 세무 설정 저장소를 갖기 전까지 쓰는 기본 세무 설정입니다. 12월 결산, 매월 원천세, 성실신고확인 대상 아님,
 * 카드 매출 전부 과세입니다. 부가세 예정 기간은 법인이 신고, 개인이 고지입니다.
 */
export const TAX_SETTINGS_WITHOUT_STORE = {
  fiscalYearEndMonth: 12,
  withholdingCycle: 'MONTHLY',
  sincereFilingTarget: false,
  taxableCardRatioPpm: 1_000_000,
} as const satisfies Pick<
  TaxProfile,
  'fiscalYearEndMonth' | 'withholdingCycle' | 'sincereFilingTarget' | 'taxableCardRatioPpm'
>

/**
 * Tax의 `TaxProfiles` 포트를 Identity & Access의 회사(`CompanyDirectory`)와 Billing이 구현한 플랜(`CompanyPlans`)으로 구현합니다.
 *
 * 사업자 형태는 회사에서, 플랜은 구독에서 읽습니다. 나머지 세무 설정은 Tax가 가져야 하지만 아직 저장소가 없어
 * {@link TAX_SETTINGS_WITHOUT_STORE}로 채웁니다.
 * - 사업연도 종료 월: 12월
 * - 원천세 납부 주기: 매월(반기별 납부 승인을 모릅니다)
 * - 부가세 예정 기간: 법인은 신고(`FILING`), 개인은 고지(`NOTICE`)
 * - 성실신고확인 대상: 아님
 * - 카드 매출 과세 비율: 100%
 */
export const TaxProfilesFromIdentityAccess: Layer.Layer<TaxProfiles, never, CompanyDirectory | CompanyPlans> =
  Layer.effect(
    TaxProfiles,
    Effect.gen(function* () {
      const companies = yield* CompanyDirectory
      const plans = yield* CompanyPlans

      const profileOf = (company: DirectoryCompany): Effect.Effect<TaxProfile> =>
        plans.plansOf(company.id).pipe(
          Effect.map((active) => ({
            ...TAX_SETTINGS_WITHOUT_STORE,
            companyId: company.id,
            businessType: company.businessType,
            vatPreliminaryMode: company.businessType === 'CORPORATION' ? 'FILING' : 'NOTICE',
            plans: [...active].toSorted(),
          })),
        )

      return TaxProfiles.of({
        get: (companyId) =>
          companies.find(companyId).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(Option.none<TaxProfile>()),
                onSome: (company) => profileOf(company).pipe(Effect.map(Option.some)),
              }),
            ),
          ),
        listTaxation: () =>
          companies.list().pipe(
            Effect.flatMap((all) => Effect.forEach(all, profileOf)),
            Effect.map((profiles) => profiles.filter((profile) => profile.plans.includes('TAXATION'))),
          ),
      })
    }),
  )
