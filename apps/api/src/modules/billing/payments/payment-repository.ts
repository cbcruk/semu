import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { PaymentId, PaymentRecord } from './payment.ts'

/** 결제 번호 카운터입니다. `billing_counters` 표에 한 줄로 둡니다. */
interface PaymentNumberCounter {
  readonly id: typeof PAYMENT_NUMBER
  readonly value: number
}

const PAYMENT_NUMBER = 'payment_number'

/** 결제 저장소입니다. */
export class PaymentRepository extends Context.Service<
  PaymentRepository,
  {
    find(companyId: Id<'company'>, paymentId: PaymentId): Effect.Effect<Option.Option<PaymentRecord>>
    /** 결제를 출금일 최신순(같으면 번호 큰 순)으로 돌려줍니다. */
    listByCompany(companyId: Id<'company'>): Effect.Effect<PaymentRecord[]>
    listAll(): Effect.Effect<PaymentRecord[]>
    /** 다음 결제 번호입니다. 번호는 다시 쓰지 않습니다. */
    nextNumber(): Effect.Effect<number>
    save(payment: PaymentRecord): Effect.Effect<void>
  }
>()('semu/billing/PaymentRepository') {
  /**
   * 결제는 `billing_payments`, 마지막으로 쓴 결제 번호는 `billing_counters`(ID `payment_number`) 표에 둡니다.
   * 표가 비어 있으면 `seed`로 시작하고, 번호는 1000과 시드 번호 중 큰 값 다음부터입니다.
   */
  static readonly layer = (seed: ReadonlyArray<PaymentRecord> = []) =>
    Layer.effect(
      PaymentRepository,
      Effect.gen(function* () {
        const factory = yield* TableFactory
        const table = yield* factory.make<PaymentRecord>('billing_payments', {
          seed,
          companyOf: (row) => row.companyId,
        })
        const counters = yield* factory.make<PaymentNumberCounter>('billing_counters', {
          seed: [{ id: PAYMENT_NUMBER, value: Math.max(1000, ...seed.map((row) => row.number)) }],
        })
        return PaymentRepository.of({
          find: (companyId, paymentId) =>
            Effect.map(
              table.get(paymentId),
              Option.filter((row) => row.companyId === companyId),
            ),
          listByCompany: (companyId) =>
            Effect.map(table.byCompany(companyId), (rows) =>
              rows.toSorted((a, b) => b.scheduledOn.localeCompare(a.scheduledOn) || b.number - a.number),
            ),
          listAll: () => Effect.map(table.all(), (rows) => [...rows]),
          nextNumber: () =>
            Effect.gen(function* () {
              const current = yield* counters.get(PAYMENT_NUMBER)
              const value = Option.match(current, { onNone: () => 1000, onSome: (counter) => counter.value }) + 1
              yield* counters.put({ id: PAYMENT_NUMBER, value })
              return value
            }),
          save: (payment) => table.put(payment),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 결제를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<PaymentRecord> = []) =>
    PaymentRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
