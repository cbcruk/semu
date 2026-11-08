import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { BookkeepingMemoryLive } from '../bookkeeping.layer.ts'
import { BankTransactionRepository, EvidenceRepository, GiroRepository } from '../common/repositories.ts'
import { VatEvidenceQuery } from '../vat/vat-evidence-query.ts'
import { ScrapedRecordIngestion } from './scraped-record-ingestion.ts'
import type { ScrapedRecord } from './scraped-record.types.ts'

const COMPANY = 'cmp_01JBQ000000000000000000077' as Id<'company'>
const ACCOUNT = { bankCode: '004', accountNumber: '999-000-111222' }

function run<A, E>(
  effect: Effect.Effect<
    A,
    E,
    ScrapedRecordIngestion | EvidenceRepository | BankTransactionRepository | GiroRepository | VatEvidenceQuery
  >,
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, BookkeepingMemoryLive))
}

describe('수집 레코드 받기', () => {
  it('같은 수집 키는 한 번만 받고 사람이 고친 값은 덮지 않습니다', async () => {
    const card: ScrapedRecord = {
      type: 'CARD_APPROVAL',
      cardNumberMasked: '9410-****-****-1234',
      approvalNo: 'A1',
      approvedAt: '2026-10-09T12:30:00+09:00',
      merchantName: '한식당',
      amount: 22_000,
    }
    const result = await run(
      Effect.gen(function* () {
        const ingestion = yield* ScrapedRecordIngestion
        const evidence = yield* EvidenceRepository
        const first = yield* ingestion.ingest(COMPANY, [card])
        const [row] = yield* evidence.list(COMPANY)
        yield* evidence.save({ ...row!, memo: '점심' })
        const second = yield* ingestion.ingest(COMPANY, [{ ...card, merchantName: '한식당 본점' }])
        return { first, second, rows: yield* evidence.list(COMPANY) }
      }),
    )

    expect(result.first).toEqual({ insertedCount: 1, updatedCount: 0, rejected: [], classifiedCount: 0 })
    expect(result.second).toMatchObject({ insertedCount: 0, updatedCount: 1 })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      side: 'PURCHASE',
      source: 'CARD',
      externalKey: 'A1:9410-****-****-1234:2026-10-09T12:30:00+09:00',
      counterpartyName: '한식당 본점',
      supplyAmount: 22_000,
      vatAmount: 0,
      memo: '점심',
    })
  })

  it('계좌를 거래보다 먼저 만들고 받지 못한 레코드는 위치와 함께 알려 줍니다', async () => {
    const result = await run(
      Effect.gen(function* () {
        const ingestion = yield* ScrapedRecordIngestion
        return yield* ingestion.ingest(COMPANY, [
          {
            type: 'BANK_TRANSACTION',
            ...ACCOUNT,
            externalKey: 't1',
            transactedAt: '2026-10-01T09:00:00+09:00',
            amount: 1_000,
            balanceAfter: 1_000,
          },
          { type: 'BANK_ACCOUNT', ...ACCOUNT, accountTypeCode: '01' },
          { type: 'BANK_BALANCE', bankCode: '088', accountNumber: '000', date: '2026-10-01', closingBalance: 0 },
          { type: 'PURCHASE_EVIDENCE', source: 'PG', externalKey: 'x', writtenOn: '2026-10-01', supplyAmount: 1 },
          { type: 'SALES_EVIDENCE', source: 'CARD', externalKey: 'y', writtenOn: '2026-13-01', totalAmount: 1 },
        ])
      }),
    )

    expect(result).toEqual({
      insertedCount: 2,
      updatedCount: 0,
      rejected: [
        { index: 2, reason: 'BANK_ACCOUNT_UNKNOWN' },
        { index: 3, reason: 'SOURCE_SIDE_MISMATCH' },
        { index: 4, reason: 'DATE_INVALID' },
      ],
      classifiedCount: 0,
    })
  })

  it('지로 고지서를 다시 읽으면 새 고지서, 납부된 고지서, 목록에서 빠진 고지서를 각각 반영합니다', async () => {
    const bill = (number: string, isPaid = false) => ({
      electronicPaymentNumber: number,
      taxKind: 'NATIONAL' as const,
      slipType: '국세',
      taxName: '원천세',
      payAmount: 1_000,
      detail: {},
      isPaid,
    })
    const statuses = await run(
      Effect.gen(function* () {
        const ingestion = yield* ScrapedRecordIngestion
        yield* ingestion.ingest(COMPANY, [{ type: 'GIRO_BILLS', bills: [bill('1'), bill('2'), bill('3', true)] }])
        yield* ingestion.ingest(COMPANY, [{ type: 'GIRO_BILLS', bills: [bill('2', true)] }])
        const giros = yield* GiroRepository
        return Object.fromEntries((yield* giros.list(COMPANY)).map((row) => [row.electronicPaymentNumber, row.status]))
      }),
    )

    expect(statuses).toEqual({ '1': 'UNKNOWN', '2': 'DONE', '3': 'DONE' })
  })
})

describe('부가세 증빙 조회', () => {
  it('데모 10월 매출·매입 증빙을 원천 세액 그대로 돌려줍니다', async () => {
    const evidence = await run(
      Effect.flatMap(VatEvidenceQuery, (query) =>
        query.forPeriod('cmp_01JBQ000000000000000000001' as Id<'company'>, { start: '2026-10-01', end: '2026-10-31' }),
      ),
    )

    expect(evidence.sales).toHaveLength(6)
    expect(evidence.purchases.map((row) => row.vatDeduction).sort()).toEqual([
      'DEDUCTIBLE',
      'NON_DEDUCTIBLE',
      'UNDECIDED',
    ])
    expect(
      evidence.sales
        .filter((row) => row.vatAmount === null)
        .map((row) => row.totalAmount)
        .sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([-1_100_000, 11_000_000])
    expect(evidence.sales.filter((row) => row.dedupeGroup === 'order-77')).toHaveLength(2)
  })
})
