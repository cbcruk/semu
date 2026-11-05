import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { EvidenceRepository } from '../common/repositories.ts'
import type { EvidenceSource, VatDeduction } from '../evidence/evidence.types.ts'

/**
 * 예상 부가세가 읽는 매출 증빙 한 건입니다. 금액은 수집한 값 그대로이고, 세액을 받지 못했으면 `vatAmount`가 `null`입니다.
 *
 * 세액을 나눌지, 같은 `dedupeGroup`을 한 건으로 볼지는 Tax가 정합니다.
 */
export interface VatSalesEvidence {
  evidenceId: Id<'evidence'>
  source: EvidenceSource
  writtenOn: string
  issuedOn: string
  totalAmount: number | null
  supplyAmount: number | null
  vatAmount: number | null
  /** 카드 매출의 결제 수단 원문입니다. 카드 매출 비율 계산에 씁니다. */
  channel: string | null
  dedupeGroup: string | null
  isCanceled: boolean
  syncedAt: string
}

/** 예상 부가세가 읽는 매입 증빙 한 건입니다. */
export interface VatPurchaseEvidence {
  evidenceId: Id<'evidence'>
  source: EvidenceSource
  writtenOn: string
  issuedOn: string
  supplyAmount: number | null
  vatAmount: number | null
  vatDeduction: VatDeduction
  isCanceled: boolean
  syncedAt: string
}

/** 기간의 부가세 증빙입니다. */
export interface VatEvidence {
  sales: VatSalesEvidence[]
  purchases: VatPurchaseEvidence[]
  /** 기간 증빙 가운데 가장 최근 수집 시각입니다. 없으면 `null`입니다. */
  lastSyncedAt: string | null
}

/**
 * Tax가 예상 부가세를 계산할 때 읽는 증빙 조회입니다 (`bookkeeping.public.ts`).
 *
 * 기간은 작성일자 기준이고 양 끝을 포함합니다. 분류 여부와 상관없이 모든 증빙을 줍니다.
 */
export class VatEvidenceQuery extends Context.Service<
  VatEvidenceQuery,
  { forPeriod(companyId: Id<'company'>, period: { start: string; end: string }): Effect.Effect<VatEvidence> }
>()('semu/bookkeeping/VatEvidenceQuery') {
  static readonly layer = Layer.effect(
    VatEvidenceQuery,
    Effect.gen(function* () {
      const evidence = yield* EvidenceRepository
      return VatEvidenceQuery.of({
        forPeriod: (companyId, period) =>
          Effect.map(evidence.list(companyId), (rows) => {
            const inPeriod = rows.filter((row) => row.writtenOn >= period.start && row.writtenOn <= period.end)
            const result: VatEvidence = { sales: [], purchases: [], lastSyncedAt: null }
            for (const row of inPeriod) {
              const common = {
                evidenceId: row.id,
                source: row.source,
                writtenOn: row.writtenOn,
                issuedOn: row.issuedOn,
                supplyAmount: row.supplyAmount,
                vatAmount: row.vatAmount,
                isCanceled: row.isCanceled,
                syncedAt: row.syncedAt,
              }
              if (row.side === 'SALES') {
                result.sales.push({
                  ...common,
                  totalAmount: row.totalAmount,
                  channel: row.channel,
                  dedupeGroup: row.dedupeGroup,
                })
              } else {
                result.purchases.push({ ...common, vatDeduction: row.vatDeduction })
              }
              if (result.lastSyncedAt === null || row.syncedAt > result.lastSyncedAt) result.lastSyncedAt = row.syncedAt
            }
            return result
          }),
      })
    }),
  )
}
