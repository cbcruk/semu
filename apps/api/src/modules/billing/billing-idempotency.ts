import { Context, Layer } from 'effect'
import { makeIdempotencyStore, type IdempotencyStore } from '../../shared/persistence/idempotency-store.ts'
import { TableFactory } from '../../shared/persistence/record-table.ts'

/** 결제 재시도·환불과 출금 계좌 등록의 `Idempotency-Key` 요청 기록입니다. 세 엔드포인트가 한 표를 씁니다. */
export class BillingIdempotency extends Context.Service<BillingIdempotency, IdempotencyStore>()(
  'semu/billing/BillingIdempotency',
) {
  /** `billing_idempotency_keys` 표에 둡니다. */
  static readonly layer = Layer.effect(BillingIdempotency, makeIdempotencyStore('billing_idempotency_keys'))

  /** 프로세스 메모리에 둡니다. */
  static readonly layerMemory = BillingIdempotency.layer.pipe(Layer.provide(TableFactory.layerMemory))
}
