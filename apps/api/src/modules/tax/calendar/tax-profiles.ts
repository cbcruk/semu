import { Context, Effect, Layer, Option } from 'effect'
import type { Plan } from '../../identity-access/actor.types.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TaxSettingRepository } from '../settings/tax-setting-repository.ts'
import type { TaxSettingRecord } from '../settings/tax-setting.types.ts'
import type { TaxCalendarProfile } from './filing-calendar.types.ts'
import { TaxCompanies } from './tax-companies.ts'
import type { TaxCompany } from './tax-companies.ts'

/**
 * 신고 일정과 예상 부가세를 정하는 회사의 세무 프로필입니다.
 *
 * 사업자 형태와 플랜은 Identity & Access·Billing이(`TaxCompanies` 포트), 나머지 세무 설정은 Tax의 세무 설정 저장소가 갖습니다.
 * {@link TaxProfiles}가 둘을 합칩니다.
 */
export interface TaxProfile extends TaxCalendarProfile {
  companyId: Id<'company'>
  plans: ReadonlyArray<Plan>
  /** 카드 매출 중 과세 매출 비율입니다. ppm(100% = 1,000,000)입니다. */
  taxableCardRatioPpm: number
}

/**
 * 회사 세무 프로필을 읽는 Tax 내부 서비스입니다. 일정 배치·세무 달력·예상 부가세가 씁니다.
 *
 * 회사 사실(`TaxCompanies` 포트)과 저장된 세무 설정(`TaxSettingRepository`)을 Tax 안에서 합칩니다. 어댑터가 Tax의 설정 조회를
 * 읽어 합치는 방법도 있지만, 그러면 Tax의 저장소가 다른 컨텍스트를 거쳐 Tax로 돌아오고 테스트마다 어댑터를 띄워야 설정이 보입니다.
 * 포트는 Tax가 모르는 사실만 받고 합치기는 설정을 가진 Tax가 하므로, 일정을 쓰는 코드는 바뀌지 않고 저장한 설정을 봅니다.
 */
export class TaxProfiles extends Context.Service<
  TaxProfiles,
  {
    get(companyId: Id<'company'>): Effect.Effect<Option.Option<TaxProfile>>
    /** 세무 기장(`TAXATION`) 회사 전체입니다. 신고 건은 이 회사들에만 만듭니다. */
    listTaxation(): Effect.Effect<ReadonlyArray<TaxProfile>>
  }
>()('semu/tax/TaxProfiles') {
  /** `TaxCompanies` 포트와 `TaxSettingRepository`로 만듭니다. 저장한 적 없는 회사는 기본 설정입니다. */
  static readonly layer = Layer.effect(
    TaxProfiles,
    Effect.gen(function* () {
      const companies = yield* TaxCompanies
      const settings = yield* TaxSettingRepository

      const profileOf = (company: TaxCompany): Effect.Effect<TaxProfile> =>
        settings.get(company.companyId).pipe(Effect.map((setting) => mergeProfile(company, setting)))

      return TaxProfiles.of({
        get: (companyId) =>
          companies.get(companyId).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(Option.none<TaxProfile>()),
                onSome: (company) => profileOf(company).pipe(Effect.map(Option.some)),
              }),
            ),
          ),
        listTaxation: () => companies.listTaxation().pipe(Effect.flatMap((all) => Effect.forEach(all, profileOf))),
      })
    }),
  )
}

/** 회사 사실과 저장된 세무 설정을 프로필 하나로 합칩니다. 설정의 `version`·`updatedAt`은 프로필에 넣지 않습니다. */
export function mergeProfile(company: TaxCompany, setting: TaxSettingRecord): TaxProfile {
  return {
    companyId: company.companyId,
    businessType: company.businessType,
    plans: [...company.plans].toSorted(),
    fiscalYearEndMonth: setting.fiscalYearEndMonth,
    withholdingCycle: setting.withholdingCycle,
    sincereFilingTarget: setting.sincereFilingTarget,
    vatTaxpayerType: setting.vatTaxpayerType,
    vatSimplifiedInvoiceIssuer: setting.vatSimplifiedInvoiceIssuer,
    taxableCardRatioPpm: setting.taxableCardRatioPpm,
    vatSupplyAmounts: setting.vatSupplyAmounts,
    vatPreliminaryElections: setting.vatPreliminaryElections,
  }
}

/** 프로필을 회사 사실과 저장할 세무 설정으로 나눕니다. 테스트 시드가 프로필로 저장소를 채울 때 씁니다. */
export function splitProfile(
  profile: TaxProfile,
  stored: Pick<TaxSettingRecord, 'version' | 'updatedAt'>,
): { company: TaxCompany; setting: TaxSettingRecord } {
  return {
    company: { companyId: profile.companyId, businessType: profile.businessType, plans: profile.plans },
    setting: {
      fiscalYearEndMonth: profile.fiscalYearEndMonth,
      withholdingCycle: profile.withholdingCycle,
      sincereFilingTarget: profile.sincereFilingTarget,
      vatTaxpayerType: profile.vatTaxpayerType,
      vatSimplifiedInvoiceIssuer: profile.vatSimplifiedInvoiceIssuer ?? false,
      taxableCardRatioPpm: profile.taxableCardRatioPpm,
      vatSupplyAmounts: profile.vatSupplyAmounts,
      vatPreliminaryElections: profile.vatPreliminaryElections,
      ...stored,
    },
  }
}
