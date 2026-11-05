import { Context, Effect, Layer } from 'effect'

/**
 * 기한을 미루는 쉬는 날(공휴일·대체공휴일·임시공휴일·근로자의 날)을 읽는 포트입니다.
 *
 * 주말은 넣지 않습니다. 표가 바뀌면 일정 배치가 열린 신고 건의 기한을 다시 맞춥니다.
 */
export class PublicHolidays extends Context.Service<
  PublicHolidays,
  {
    between(from: string, to: string): Effect.Effect<ReadonlySet<string>>
  }
>()('semu/tax/PublicHolidays') {
  /** 정해 둔 날짜로 답하는 가짜입니다. */
  static readonly layerMemory = (dates: ReadonlyArray<string> = []) =>
    Layer.succeed(
      PublicHolidays,
      PublicHolidays.of({
        between: (from, to) => Effect.succeed(new Set(dates.filter((date) => date >= from && date <= to))),
      }),
    )
}
