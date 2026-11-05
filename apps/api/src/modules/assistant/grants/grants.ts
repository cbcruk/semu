import { Clock, Context, Effect, Layer, Option } from 'effect'
import { paginate } from '../../../shared/http/pagination.ts'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { GrantNotFound } from './grant.ts'
import type { GrantRecord } from './grant.ts'
import { CompanyGrantProfiles } from './grant-profiles.ts'
import { openGrants, recommendGrants } from './grant-recommendation.ts'
import { GrantRepository } from './grant-repository.ts'

/** 지원사업 공고 조회와 맞춤 추천입니다. "오늘"은 회사 시간대(`Asia/Seoul`)의 날짜입니다. */
export class Grants extends Context.Service<
  Grants,
  {
    /** `전체 지원금`입니다. 오늘 신청 가능한 공고를 마감 임박순으로 돌려줍니다. */
    listOpen(query: PageQuery): Effect.Effect<PageOf<GrantRecord>>
    get(grantId: Id<'grant'>): Effect.Effect<GrantRecord, GrantNotFound>
    /** `맞춤 추천`입니다. 행위자 회사의 업종·지역에 맞는 공고 최대 15개입니다. */
    recommend(actor: Actor): Effect.Effect<GrantRecord[]>
  }
>()('semu/assistant/Grants') {
  static readonly layer = Layer.effect(
    Grants,
    Effect.gen(function* () {
      const repository = yield* GrantRepository
      const profiles = yield* CompanyGrantProfiles
      const today = Clock.currentTimeMillis.pipe(Effect.map(companyDate))
      return Grants.of({
        listOpen: (query) =>
          Effect.gen(function* () {
            const grants = openGrants(yield* repository.list(), yield* today)
            return paginate(grants, (grant) => `${grant.applyEndOn ?? '9999-12-31'}|${grant.id}`, query, {
              includeTotal: true,
            })
          }),
        get: (grantId) =>
          repository
            .find(grantId)
            .pipe(
              Effect.flatMap(
                Option.match({ onNone: () => Effect.fail(new GrantNotFound({})), onSome: Effect.succeed }),
              ),
            ),
        recommend: (actor) =>
          Effect.gen(function* () {
            const profile = yield* profiles.profileOf(actor.companyId)
            return recommendGrants(yield* repository.list(), profile, yield* today)
          }),
      })
    }),
  )
}
