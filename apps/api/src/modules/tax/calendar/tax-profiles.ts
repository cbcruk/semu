import { Context, Effect, Layer, Option } from 'effect'
import type { Plan } from '../../identity-access/actor.types.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { TaxCalendarProfile } from './filing-calendar.types.ts'

/**
 * 신고 일정과 예상 부가세를 정하는 회사의 세무 프로필입니다.
 *
 * 사업자 형태와 플랜은 Identity & Access·Billing이, 나머지 세무 설정은 Tax가 갖습니다. 포트 구현이 둘을 합칩니다.
 */
export interface TaxProfile extends TaxCalendarProfile {
  companyId: Id<'company'>
  plans: ReadonlyArray<Plan>
  /** 카드 매출 중 과세 매출 비율입니다. ppm(100% = 1,000,000)입니다. */
  taxableCardRatioPpm: number
}

/** 회사 세무 프로필을 읽는 포트입니다. 일정 배치는 행위자 없이 돌기 때문에 회사 목록도 받습니다. */
export class TaxProfiles extends Context.Service<
  TaxProfiles,
  {
    get(companyId: Id<'company'>): Effect.Effect<Option.Option<TaxProfile>>
    /** 세무 기장(`TAXATION`) 회사 전체입니다. 신고 건은 이 회사들에만 만듭니다. */
    listTaxation(): Effect.Effect<ReadonlyArray<TaxProfile>>
  }
>()('semu/tax/TaxProfiles') {
  /** 정해 둔 프로필로 답하는 가짜입니다. */
  static readonly layerMemory = (profiles: ReadonlyArray<TaxProfile> = []) =>
    Layer.succeed(
      TaxProfiles,
      TaxProfiles.of({
        get: (companyId) =>
          Effect.succeed(Option.fromNullishOr(profiles.find((profile) => profile.companyId === companyId))),
        listTaxation: () => Effect.succeed(profiles.filter((profile) => profile.plans.includes('TAXATION'))),
      }),
    )
}
