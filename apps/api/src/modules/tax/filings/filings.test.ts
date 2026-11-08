import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { filingRecord } from '../tax-demo.ts'
import { taxMemoryLayer, WithholdingFilingLockLive } from '../tax.layer.ts'
import { WithholdingFilingLock } from '../tax.public.ts'
import { ActionCards } from '../action-cards/action-cards.ts'
import type { FilingRecord } from './filing.types.ts'
import { FilingRepository } from './filing-repository.ts'
import { Filings } from './filings.ts'
import type { PayrollLedgerSummary } from './filing-requirements.types.ts'

const WHT_ID = 'fil_01JBQ000000000000000000W01' as Id<'filing'>

function withholding(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return filingRecord({
    id: WHT_ID,
    taxType: 'WITHHOLDING_TAX',
    kind: 'MONTHLY',
    periodKey: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    status: 'REQUESTED',
    ...overrides,
  })
}

function run<A>(
  effect: Effect.Effect<A, never, Filings | FilingRepository | WithholdingFilingLock>,
  seed: { filings: FilingRecord[]; payrollLedgers?: Record<string, PayrollLedgerSummary> },
) {
  const services = Layer.mergeAll(Filings.layer.pipe(Layer.provide(ActionCards.layer)), WithholdingFilingLockLive)
  return Effect.runPromise(effect.pipe(Effect.provide(Layer.provideMerge(services, taxMemoryLayer(seed)))))
}

const ledgerResponse = Effect.gen(function* () {
  const repository = yield* FilingRepository
  const filing = Option.getOrThrow(yield* repository.findById(TEST_COMPANY_ID, WHT_ID))
  return filing.requirements.find((requirement) => requirement.code === 'PAYROLL_LEDGER_CLOSED')!.response
})

describe('급여대장 마감 연계(Filings.syncPayrollLedger)', () => {
  it('기간의 급여대장이 모두 마감되면 급여대장 항목이 PROVIDED가 됩니다', async () => {
    const response = await run(
      Effect.gen(function* () {
        yield* (yield* Filings).syncPayrollLedger(TEST_COMPANY_ID, '2026-10')
        return yield* ledgerResponse
      }),
      { filings: [withholding()], payrollLedgers: { '2026-10': { ledgerCount: 2, closedCount: 2 } } },
    )

    expect(response).toBe('PROVIDED')
  })

  it('급여대장을 다시 열면 항목이 PENDING으로 돌아갑니다', async () => {
    const provided = withholding()
    provided.requirements[0] = { ...provided.requirements[0]!, response: 'PROVIDED' }
    const response = await run(
      Effect.gen(function* () {
        yield* (yield* Filings).syncPayrollLedger(TEST_COMPANY_ID, '2026-10')
        return yield* ledgerResponse
      }),
      { filings: [provided], payrollLedgers: { '2026-10': { ledgerCount: 2, closedCount: 1 } } },
    )

    expect(response).toBe('PENDING')
  })
})

describe('원천세 신고 잠금(WithholdingFilingLock)', () => {
  it.each([
    ['FILED', true],
    ['SETTLED', true],
    ['PREPARING', false],
    ['CANCELED', false],
  ] as const)('%s 상태의 신고 여부는 %s입니다', async (status, filed) => {
    const result = await run(
      Effect.gen(function* () {
        return yield* (yield* WithholdingFilingLock).isFiled(TEST_COMPANY_ID, '2026-10')
      }),
      { filings: [withholding({ status })] },
    )

    expect(result).toBe(filed)
  })
})
