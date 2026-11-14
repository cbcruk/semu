import { Effect, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { Scheduler } from '../../../shared/scheduler/scheduler.ts'
import { BillingMemoryStoreLive, PaymentsLive } from '../billing.layer.ts'
import { DEMO_PAYMENT_IDS } from '../billing-seed.ts'
import { CmsGateway, CmsUnavailable } from '../mandates/cms-gateway.ts'
import type { WithdrawalResultLine } from '../mandates/cms-gateway.ts'
import { PaymentRepository } from './payment-repository.ts'
import { PublicHolidays } from './public-holidays.ts'
import { withdrawalResultTask } from './withdrawal-result-task.ts'

/** `gateway`는 저장소의 가짜 CMS 대신 실행기에 바로 넣습니다. */
const layer = (gateway: Layer.Layer<CmsGateway> = CmsGateway.layerFake) =>
  Scheduler.layer([withdrawalResultTask]).pipe(
    Layer.provideMerge(gateway),
    Layer.provideMerge(PaymentsLive),
    Layer.provideMerge(Layer.mergeAll(BillingMemoryStoreLive, PublicHolidays.layerMemory())),
    Layer.provideMerge(Layer.merge(TableFactory.layerMemory, UnitOfWork.layerNone)),
  )

const at = (local: string) => TestClock.setTime(Date.parse(`${local}+09:00`))

/** 결과 파일을 하루 늦게 주고, 그다음 날은 주어진 줄을 돌려주는 게이트웨이입니다. 날마다 받은 요청을 남깁니다. */
function lateGateway(lines: ReadonlyArray<WithdrawalResultLine>, calls: string[]) {
  let reads = 0
  return Layer.succeed(
    CmsGateway,
    CmsGateway.of({
      registerAccount: () => Effect.die('쓰지 않음'),
      withdrawalResults: (withdrawnOn) =>
        Effect.sync(() => {
          calls.push(withdrawnOn)
          reads += 1
          return reads === 1 ? Option.none() : Option.some(lines)
        }),
    }),
  )
}

describe('정기 작업 billing.withdrawal-results', () => {
  it('결과 반영일 오후에 결과 파일을 읽어 예정 결제를 완료하고, 다음 날은 읽을 것이 없습니다', async () => {
    const [runs, payment] = await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler
        // 시드의 예정 결제는 11월 25일 출금이라 결과는 26일 오후에 옵니다.
        yield* at('2026-11-25T15:00:00')
        yield* scheduler.runDue()
        yield* at('2026-11-26T15:00:00')
        yield* scheduler.runDue()
        yield* at('2026-11-27T15:00:00')
        yield* scheduler.runDue()
        const all = yield* (yield* PaymentRepository).listAll()
        return [yield* scheduler.runs(), all.find((row) => row.id === DEMO_PAYMENT_IDS.scheduled)] as const
      }).pipe(Effect.provide(layer()), Effect.provide(TestClock.layer())),
    )

    expect(runs.map((run) => [run.slot, run.result])).toEqual([
      ['2026-11-27T15:00', { withdrawals: 0, paid: 0, failed: 0, pending: 0 }],
      ['2026-11-26T15:00', { withdrawals: 1, paid: 1, failed: 0, pending: 0 }],
      ['2026-11-25T15:00', { withdrawals: 0, paid: 0, failed: 0, pending: 0 }],
    ])
    expect(payment).toMatchObject({ status: 'PAID', settledAt: expect.any(String) })
  })

  it('결과 파일이 아직 없으면 다음 날 다시 읽어 실패 사유를 남깁니다', async () => {
    const calls: string[] = []
    const gateway = lateGateway(
      [{ paymentId: DEMO_PAYMENT_IDS.scheduled, succeeded: false, failureReason: 'INSUFFICIENT_BALANCE' }],
      calls,
    )
    const [runs, payment] = await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler
        yield* at('2026-11-26T15:00:00')
        yield* scheduler.runDue()
        yield* at('2026-11-27T15:00:00')
        yield* scheduler.runDue()
        const all = yield* (yield* PaymentRepository).listAll()
        return [yield* scheduler.runs(), all.find((row) => row.id === DEMO_PAYMENT_IDS.scheduled)] as const
      }).pipe(Effect.provide(layer(gateway)), Effect.provide(TestClock.layer())),
    )

    expect(calls).toEqual(['2026-11-25', '2026-11-25'])
    expect(runs.map((run) => run.result)).toEqual([
      { withdrawals: 1, paid: 0, failed: 1, pending: 0 },
      { withdrawals: 1, paid: 0, failed: 0, pending: 1 },
    ])
    expect(payment).toMatchObject({ status: 'FAILED', failureReason: 'INSUFFICIENT_BALANCE' })
  })

  it('CMS에 닿지 못하면 실패로 남겨 다시 시도합니다', async () => {
    const down = Layer.succeed(
      CmsGateway,
      CmsGateway.of({
        registerAccount: () => Effect.die('쓰지 않음'),
        withdrawalResults: () => Effect.fail(new CmsUnavailable()),
      }),
    )
    const runs = await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler
        yield* at('2026-11-26T15:00:00')
        yield* scheduler.runDue()
        return yield* scheduler.runs()
      }).pipe(Effect.provide(layer(down)), Effect.provide(TestClock.layer())),
    )

    expect(runs[0]).toMatchObject({ status: 'FAILED', lastError: 'CmsUnavailable' })
  })
})
