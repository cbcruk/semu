import { Context, Effect, Layer } from 'effect'
import type { PayrollEvent } from './payroll-events.types.ts'

/**
 * 급여 도메인 이벤트를 내보내는 포트입니다. 운영에서는 같은 트랜잭션의 아웃박스에 쓰고 Tax가 구독합니다.
 */
export class PayrollEventPublisher extends Context.Service<
  PayrollEventPublisher,
  {
    publish(event: PayrollEvent): Effect.Effect<void>
  }
>()('semu/payroll/PayrollEventPublisher') {
  /** 이벤트를 `sink` 배열에 쌓습니다. 테스트는 넘긴 배열을 읽어 확인합니다. */
  static readonly layerMemory = (sink: PayrollEvent[] = []) =>
    Layer.succeed(
      PayrollEventPublisher,
      PayrollEventPublisher.of({
        publish: (event) =>
          Effect.sync(() => {
            sink.push(event)
          }),
      }),
    )
}
