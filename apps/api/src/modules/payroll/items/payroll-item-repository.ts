import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import { catalogOf } from './payroll-item-rules.ts'
import type { DeductionItemRecord, PaymentItemRecord, PayrollItemCatalog } from './payroll-item.types.ts'

/** {@link PayrollItemRepository}의 시작 데이터입니다. */
export interface PayrollItemSeed {
  paymentItems?: ReadonlyArray<PaymentItemRecord>
  deductionItems?: ReadonlyArray<DeductionItemRecord>
}

/** 회사의 지급·공제 항목 저장소입니다. 지운 항목도 `archivedAt`을 채워 남깁니다. */
export class PayrollItemRepository extends Context.Service<
  PayrollItemRepository,
  {
    paymentItems: TenantTable<PaymentItemRecord>
    deductionItems: TenantTable<DeductionItemRecord>
    /** 행 계산에 쓰는 회사 카탈로그입니다. 지운 항목도 들어 있습니다. */
    catalog(companyId: Id<'company'>): Effect.Effect<PayrollItemCatalog>
  }
>()('semu/payroll/PayrollItemRepository') {
  /** `payroll_payment_items`·`payroll_deduction_items` 표에 둡니다. */
  static readonly layer = (seed: PayrollItemSeed = {}) =>
    Layer.effect(
      PayrollItemRepository,
      Effect.gen(function* () {
        const paymentItems = yield* makeTenantTable<PaymentItemRecord>('payroll_payment_items', seed.paymentItems)
        const deductionItems = yield* makeTenantTable<DeductionItemRecord>(
          'payroll_deduction_items',
          seed.deductionItems,
        )
        return PayrollItemRepository.of({
          paymentItems,
          deductionItems,
          catalog: (companyId) =>
            Effect.gen(function* () {
              return catalogOf(yield* paymentItems.list(companyId), yield* deductionItems.list(companyId))
            }),
        })
      }),
    )

  /** 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (seed: PayrollItemSeed = {}) =>
    PayrollItemRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
