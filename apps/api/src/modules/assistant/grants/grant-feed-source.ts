import { Context, Data, Effect, Layer } from 'effect'
import type { GrantNotice } from './grant-feed.ts'

/** 공고 원천을 읽지 못했습니다. 정기 작업이 다음에 다시 시도합니다. */
export class GrantFeedUnavailable extends Data.TaggedError('GrantFeedUnavailable')<{ readonly source: string }> {}

/**
 * 지원사업 공고 원천입니다. 지금 신청을 받거나 앞으로 받을 공고를 모두 돌려줍니다.
 *
 * 운영 어댑터는 기업마당(`BIZINFO`) 지원사업정보 API를 읽고, 원천의 업종·지역 코드를 한국표준산업분류·법정동 코드 앞부분으로
 * 바꿉니다([규칙 결정](../../../../../../docs/design/rule-decisions/assistant.md#grant-recommendation) 5). 원천을 더하면 어댑터를
 * 더하고 `source`로 구분합니다.
 */
export class GrantFeedSource extends Context.Service<
  GrantFeedSource,
  {
    notices(): Effect.Effect<ReadonlyArray<GrantNotice>, GrantFeedUnavailable>
  }
>()('semu/assistant/GrantFeedSource') {
  /** 주어진 공고를 그대로 돌려주는 가짜입니다. 운영 어댑터가 생기기 전까지 서버도 이것을 씁니다(빈 목록). */
  static readonly layerMemory = (notices: ReadonlyArray<GrantNotice> = []) =>
    Layer.succeed(GrantFeedSource, GrantFeedSource.of({ notices: () => Effect.succeed(notices) }))
}
