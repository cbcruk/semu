import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { PaymentId, PaymentRecord } from './payment.ts'

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
  /** `seed`로 시작해 프로세스 메모리에 결제를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<PaymentRecord> = []) =>
    Layer.effect(
      PaymentRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((row) => [row.id, row])))
        const counter = yield* Ref.make(Math.max(1000, ...seed.map((row) => row.number)))
        return PaymentRepository.of({
          find: (companyId, paymentId) =>
            Ref.get(store).pipe(
              Effect.map((rows) =>
                Option.filter(Option.fromNullishOr(rows.get(paymentId)), (row) => row.companyId === companyId),
              ),
            ),
          listByCompany: (companyId) =>
            Ref.get(store).pipe(
              Effect.map((rows) =>
                [...rows.values()]
                  .filter((row) => row.companyId === companyId)
                  .sort((a, b) => b.scheduledOn.localeCompare(a.scheduledOn) || b.number - a.number),
              ),
            ),
          listAll: () => Ref.get(store).pipe(Effect.map((rows) => [...rows.values()])),
          nextNumber: () => Ref.updateAndGet(counter, (number) => number + 1),
          save: (payment) => Ref.update(store, (rows) => new Map(rows).set(payment.id, payment)),
        })
      }),
    )
}
