import { Effect, Layer } from 'effect'
import type { Id } from '../shared/ids/ids.types.ts'
import { VatEvidenceQuery } from '../modules/bookkeeping/bookkeeping.public.ts'
import type { VatPurchaseEvidence, VatSalesEvidence } from '../modules/bookkeeping/bookkeeping.public.ts'
import { VatEvidence } from '../modules/tax/tax.public.ts'
import type { PurchaseEvidence, PurchaseSource, SalesEvidence } from '../modules/tax/tax.public.ts'

const PURCHASE_SOURCES: ReadonlyArray<string> = [
  'TAX_INVOICE',
  'CASH_RECEIPT',
  'CARD',
] satisfies ReadonlyArray<PurchaseSource>

/**
 * Tax의 `VatEvidence` 포트를 Bookkeeping의 `VatEvidenceQuery`로 구현합니다.
 *
 * - 기간은 Bookkeeping의 작성일자(`writtenOn`) 기준이고, Tax의 `issuedOn`에 작성일자를 넣습니다. 부가세 귀속은 작성일자로 정하기 때문입니다
 * - 매출 합계가 없으면 공급가액과 세액을 더하고, 취소 증빙은 금액을 음수로 맞춥니다
 * - 매입 세액을 받지 못했으면 0원, 공제 여부를 정하지 않았으면 `null`입니다
 * - 매출은 Tax가 요구하는 대로 작성일자, 같은 날은 ID 순으로 정렬합니다
 */
export const TaxVatEvidenceFromBookkeeping: Layer.Layer<VatEvidence, never, VatEvidenceQuery> = Layer.effect(
  VatEvidence,
  Effect.gen(function* () {
    const bookkeeping = yield* VatEvidenceQuery
    const forPeriod = (companyId: Id<'company'>, from: string, to: string) =>
      bookkeeping.forPeriod(companyId, { start: from, end: to })
    return VatEvidence.of({
      sales: (companyId, from, to) =>
        forPeriod(companyId, from, to).pipe(
          Effect.map((evidence) =>
            evidence.sales
              .map(salesEvidenceOf)
              .toSorted((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.id.localeCompare(b.id)),
          ),
        ),
      purchases: (companyId, from, to) =>
        forPeriod(companyId, from, to).pipe(
          Effect.map((evidence) => evidence.purchases.flatMap((row) => purchaseEvidenceOf(row) ?? [])),
        ),
    })
  }),
)

function salesEvidenceOf(row: VatSalesEvidence): SalesEvidence {
  const total = row.totalAmount ?? (row.supplyAmount ?? 0) + (row.vatAmount ?? 0)
  return {
    id: row.evidenceId,
    source: row.source,
    issuedOn: row.writtenOn,
    totalAmount: signed(total, row.isCanceled),
    vatAmount: row.vatAmount === null ? null : signed(row.vatAmount, row.isCanceled),
    dedupeGroup: row.dedupeGroup,
    syncedAt: row.syncedAt,
  }
}

function purchaseEvidenceOf(row: VatPurchaseEvidence): PurchaseEvidence | undefined {
  if (!isPurchaseSource(row.source)) return undefined
  return {
    id: row.evidenceId,
    source: row.source,
    issuedOn: row.writtenOn,
    vatAmount: signed(row.vatAmount ?? 0, row.isCanceled),
    deductible: row.vatDeduction === 'UNDECIDED' ? null : row.vatDeduction === 'DEDUCTIBLE',
    syncedAt: row.syncedAt,
  }
}

function isPurchaseSource(source: string): source is PurchaseSource {
  return PURCHASE_SOURCES.includes(source)
}

function signed(amount: number, isCanceled: boolean): number {
  return isCanceled ? -Math.abs(amount) : amount
}
