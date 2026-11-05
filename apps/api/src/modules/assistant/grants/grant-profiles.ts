import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { GrantProfile } from './grant-recommendation.types.ts'

/**
 * 회사의 업종·지역을 알려 주는 포트입니다. 맞춤 추천이 씁니다.
 *
 * 지역은 Identity & Access의 회사 주소(`regionCode`)에서, 업종은 홈택스 업종 코드(현행 `company_business_types`)에서 옵니다.
 * 제공하는 쪽이 정해지기 전까지 메모리 구현으로 둡니다. 모르는 회사는 업종 불명확·지역 없음입니다.
 */
export class CompanyGrantProfiles extends Context.Service<
  CompanyGrantProfiles,
  {
    profileOf(companyId: Id<'company'>): Effect.Effect<GrantProfile>
  }
>()('semu/assistant/CompanyGrantProfiles') {
  /** 고정된 회사별 업종·지역 표입니다. */
  static readonly layerMemory = (seed: Iterable<readonly [Id<'company'>, GrantProfile]> = []) => {
    const profiles = new Map(seed)
    return Layer.succeed(
      CompanyGrantProfiles,
      CompanyGrantProfiles.of({
        profileOf: (companyId) => Effect.succeed(profiles.get(companyId) ?? { industryCodes: [], regionCode: null }),
      }),
    )
  }
}
