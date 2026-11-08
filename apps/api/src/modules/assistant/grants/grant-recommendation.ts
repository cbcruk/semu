import type { GrantProfile, GrantWindow } from './grant-recommendation.types.ts'

/** 맞춤 추천의 최대 개수입니다. */
export const MAX_RECOMMENDATIONS = 15

/** 공고가 `today`에 신청 가능한지입니다. 시작일 ≤ 오늘 ≤ 마감일이거나, 시작한 상시 모집이면 참입니다. */
export function isOpenOn(grant: Pick<GrantWindow, 'applyStartOn' | 'applyEndOn'>, today: string): boolean {
  return grant.applyStartOn <= today && (grant.applyEndOn === null || today <= grant.applyEndOn)
}

/** 마감 임박순, 상시 모집은 마지막, 같으면 ID순입니다. */
export function compareByDeadline(a: GrantWindow, b: GrantWindow): number {
  if (a.applyEndOn !== b.applyEndOn) {
    if (a.applyEndOn === null) return 1
    if (b.applyEndOn === null) return -1
    return a.applyEndOn.localeCompare(b.applyEndOn)
  }
  return a.id.localeCompare(b.id)
}

/** `전체 지원금` 목록입니다. 오늘 신청 가능한 공고를 마감 임박순으로 돌려줍니다. */
export function openGrants<G extends GrantWindow>(grants: ReadonlyArray<G>, today: string): G[] {
  return grants.filter((grant) => isOpenOn(grant, today)).sort(compareByDeadline)
}

/**
 * 공고가 회사 업종·지역에 맞는지입니다.
 *
 * 코드는 앞부분 일치로 봅니다. 공고 업종 `C`(제조업)는 회사 업종 `C10`을, 공고 지역 `11`(서울)은 회사 지역 `11680`을 포함합니다.
 * 회사 업종이 비어 있으면 업종으로 거르지 않고, 회사 지역이 없으면 전국 공고만 맞습니다.
 */
export function matchesProfile(grant: GrantWindow, profile: GrantProfile): boolean {
  const 지역맞는가 =
    grant.regionCodes.length === 0 ||
    (profile.regionCode !== null &&
      grant.regionCodes.some((공고지역코드) => profile.regionCode?.startsWith(공고지역코드) === true))
  const 업종맞는가 =
    grant.industryCodes.length === 0 ||
    profile.industryCodes.length === 0 ||
    grant.industryCodes.some((공고업종코드) =>
      profile.industryCodes.some((회사업종코드) => 회사업종코드.startsWith(공고업종코드)),
    )
  return 지역맞는가 && 업종맞는가
}

/**
 * `맞춤 추천` 목록입니다. 오늘 신청 가능한 공고 중 회사에 맞는 것을 마감 임박순으로 최대 15개 고릅니다.
 *
 * @example
 * ```ts
 * recommendGrants(grants, { industryCodes: ['J62'], regionCode: '11' }, '2026-11-05')
 * ```
 */
export function recommendGrants<G extends GrantWindow>(
  grants: ReadonlyArray<G>,
  profile: GrantProfile,
  today: string,
): G[] {
  return openGrants(grants, today)
    .filter((grant) => matchesProfile(grant, profile))
    .slice(0, MAX_RECOMMENDATIONS)
}
