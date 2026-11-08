import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { FilingRepository } from '../filings/filing-repository.ts'
import { DEMO_TAX_PROFILE } from '../tax-demo.ts'
import { FilingSchedulerLive, taxMemoryLayer } from '../tax.layer.ts'
import type { TaxEvent } from '../tax.public.ts'
import { FilingScheduler } from './filing-scheduler.ts'
import type { FilingRecord } from '../filings/filing.types.ts'
import type { PayrollLedgerSummary } from '../filings/filing-requirements.types.ts'
import type { TaxProfile } from './tax-profiles.ts'

/** 2026-01부터 24개월의 급여대장이 모두 마감된 현황입니다. 테스트가 고치면 일정 배치가 다음에 물을 때 고친 값을 봅니다. */
function closedLedgers(): Record<string, PayrollLedgerSummary> {
  return Object.fromEntries(
    Array.from({ length: 24 }, (_, index) => {
      const date = new Date(Date.UTC(2026, index, 1)).toISOString().slice(0, 7)
      return [date, { ledgerCount: 1, closedCount: 1 }]
    }),
  )
}

function run<A>(
  effect: Effect.Effect<A, never, FilingScheduler | FilingRepository>,
  events: TaxEvent[] = [],
  payrollLedgers: Record<string, PayrollLedgerSummary> = closedLedgers(),
) {
  const memory = taxMemoryLayer({ profiles: [DEMO_TAX_PROFILE], payrollLedgers, events })
  return Effect.runPromise(effect.pipe(Effect.provide(Layer.provideMerge(FilingSchedulerLive, memory))))
}

const semiannual: TaxProfile = { ...DEMO_TAX_PROFILE, withholdingCycle: 'SEMIANNUAL' }

describe('신고 일정 배치(FilingScheduler)', () => {
  it('다가오는 신고 건을 한 번만 만들고 다시 돌려도 아무것도 바꾸지 않습니다', async () => {
    const [first, second, filings] = await run(
      Effect.gen(function* () {
        const scheduler = yield* FilingScheduler
        const repository = yield* FilingRepository
        return [yield* scheduler.run(), yield* scheduler.run(), yield* repository.list(TEST_COMPANY_ID)] as const
      }),
    )

    expect(first.created).toBeGreaterThan(0)
    expect(second).toEqual({ created: 0, refreshed: 0, restored: 0, canceled: 0 })
    expect(filings).toHaveLength(first.created)
    expect(filings.every((filing) => filing.status === 'SCHEDULED' && filing.history[0]!.type === 'SCHEDULED')).toBe(
      true,
    )
    const withholding = filings.find((filing) => filing.taxType === 'WITHHOLDING_TAX')!
    expect(withholding.requirements[0]).toMatchObject({
      code: 'PAYROLL_LEDGER_CLOSED',
      autoLinked: true,
      response: 'PROVIDED',
    })
  })

  it('반기 납부로 바꾸면 원천세 신고 건만 취소합니다', async () => {
    const events: TaxEvent[] = []
    const result = await run(
      Effect.gen(function* () {
        const scheduler = yield* FilingScheduler
        yield* scheduler.runFor(DEMO_TAX_PROFILE)
        return yield* scheduler.runFor(semiannual)
      }),
      events,
    )

    expect(result.canceled).toBeGreaterThan(0)
    expect(events).toHaveLength(result.canceled)
    expect(events.every((event) => event.toStatus === 'CANCELED' && event.taxType === 'WITHHOLDING_TAX')).toBe(true)
  })
})

describe('부가세 예정 건의 종류가 바뀔 때(FilingScheduler)', () => {
  /** 2027년 1월 26일에 돌립니다. 배치 기간(120일)에 2027년 1기 예정 건(4월 26일)이 듭니다. */
  function runOnJanuary26<A>(effect: Effect.Effect<A, never, FilingScheduler | FilingRepository>) {
    return run(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2027, 0, 26))
        return yield* effect
      }).pipe(Effect.provide(TestClock.layer())),
    )
  }

  const noSupplyAmount: TaxProfile = { ...DEMO_TAX_PROFILE }
  const supply140m: TaxProfile = { ...DEMO_TAX_PROFILE, vatSupplyAmounts: { '2026-H2': 140_000_000 } }

  const preliminarySlot = Effect.gen(function* () {
    const repository = yield* FilingRepository
    return (yield* repository.list(TEST_COMPANY_ID))
      .filter((filing) => filing.taxType === 'VAT' && filing.periodKey === '2027-H1' && filing.kind !== 'FINAL')
      .map((filing) => `${filing.kind}:${filing.status}`)
      .toSorted()
  })

  const setStatus = (kind: FilingRecord['kind'], status: FilingRecord['status'], actorKind: 'AGENCY' | 'SYSTEM') =>
    Effect.gen(function* () {
      const repository = yield* FilingRepository
      const filing = (yield* repository.list(TEST_COMPANY_ID)).find(
        (item) => item.taxType === 'VAT' && item.periodKey === '2027-H1' && item.kind === kind,
      )!
      yield* repository.save({
        ...filing,
        status,
        history: [
          ...filing.history,
          {
            type: status === 'CANCELED' ? 'CANCEL' : 'REQUEST',
            actorKind,
            actorId: null,
            fromStatus: filing.status,
            toStatus: status,
            detail: {},
            occurredAt: '2027-01-26T09:00:00+09:00',
          },
        ],
        version: filing.version + 1,
      })
    })

  it('공급가액을 넣었다가 지우면 배치가 취소한 예정 신고 건을 되살립니다', async () => {
    const [initial, switchedToNotice, revertedBack, rerun] = await runOnJanuary26(
      Effect.gen(function* () {
        const scheduler = yield* FilingScheduler
        yield* scheduler.runFor(noSupplyAmount)
        const initial = yield* preliminarySlot
        yield* scheduler.runFor(supply140m)
        const switchedToNotice = yield* preliminarySlot
        const result = yield* scheduler.runFor(noSupplyAmount)
        const revertedBack = yield* preliminarySlot
        return [initial, switchedToNotice, { result, revertedBack }, yield* scheduler.runFor(noSupplyAmount)] as const
      }),
    )

    expect(initial).toEqual(['PRELIMINARY:SCHEDULED'])
    expect(switchedToNotice).toEqual(['NOTICE:SCHEDULED', 'PRELIMINARY:CANCELED'])
    expect(revertedBack.revertedBack).toEqual(['NOTICE:CANCELED', 'PRELIMINARY:SCHEDULED'])
    expect(revertedBack.result).toMatchObject({ created: 0, restored: 1, canceled: 1 })
    expect(rerun).toEqual({ created: 0, refreshed: 0, restored: 0, canceled: 0 })
  })

  it('예정신고 선택을 넣었다가 빼도 예정 건이 하나 남습니다', async () => {
    const individualProfile: TaxProfile = { ...DEMO_TAX_PROFILE, businessType: 'INDIVIDUAL' }
    const result = await runOnJanuary26(
      Effect.gen(function* () {
        const scheduler = yield* FilingScheduler
        yield* scheduler.runFor(individualProfile)
        yield* scheduler.runFor({ ...individualProfile, vatPreliminaryElections: { '2027-H1': 'EARLY_REFUND' } })
        yield* scheduler.runFor(individualProfile)
        return yield* preliminarySlot
      }),
    )

    expect(result).toEqual(['NOTICE:SCHEDULED', 'PRELIMINARY:CANCELED'])
  })

  it('예정 신고 건이 SCHEDULED를 지났으면 판정이 바뀌어도 예정고지 건을 만들지 않습니다', async () => {
    const result = await runOnJanuary26(
      Effect.gen(function* () {
        const scheduler = yield* FilingScheduler
        yield* scheduler.runFor(noSupplyAmount)
        yield* setStatus('PRELIMINARY', 'REQUESTED', 'AGENCY')
        yield* scheduler.runFor(supply140m)
        return yield* preliminarySlot
      }),
    )

    expect(result).toEqual(['PRELIMINARY:REQUESTED'])
  })

  it('대리인이 취소한 예정 자리에는 판정이 바뀌어도 어느 종류도 만들거나 되살리지 않습니다', async () => {
    const result = await runOnJanuary26(
      Effect.gen(function* () {
        const scheduler = yield* FilingScheduler
        yield* scheduler.runFor(noSupplyAmount)
        yield* setStatus('PRELIMINARY', 'CANCELED', 'AGENCY')
        yield* scheduler.runFor(noSupplyAmount)
        const unchanged = yield* preliminarySlot
        yield* scheduler.runFor(supply140m)
        yield* scheduler.runFor(noSupplyAmount)
        return [unchanged, yield* preliminarySlot] as const
      }),
    )

    expect(result[0]).toEqual(['PRELIMINARY:CANCELED'])
    expect(result[1]).toEqual(['PRELIMINARY:CANCELED'])
  })
})

describe('배치가 되살린 원천세 신고 건의 체크리스트(FilingScheduler)', () => {
  it('매월 → 반기 → 매월로 되돌리면 급여대장 마감 항목은 지금 현황으로 맞추고 대리인이 답한 항목은 그대로 둡니다', async () => {
    // 2027년 1월 26일에 돌립니다. 2027-01 원천세(2월 10일 기한)가 배치 기간에 듭니다
    const ledgers = { ...closedLedgers(), '2027-01': { ledgerCount: 1, closedCount: 0 } }
    const january = Effect.gen(function* () {
      const repository = yield* FilingRepository
      return (yield* repository.list(TEST_COMPANY_ID)).find(
        (filing) => filing.taxType === 'WITHHOLDING_TAX' && filing.periodKey === '2027-01',
      )!
    })
    const requirement = (filing: FilingRecord, code: FilingRecord['requirements'][number]['code']) =>
      filing.requirements.find((item) => item.code === code)!

    const [scheduled, canceled, result, restored] = await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2027, 0, 26))
        const scheduler = yield* FilingScheduler
        const repository = yield* FilingRepository
        yield* scheduler.runFor(DEMO_TAX_PROFILE)
        const scheduled = yield* january
        yield* repository.save({
          ...scheduled,
          requirements: scheduled.requirements.map((item) =>
            item.code === 'BUSINESS_INCOME'
              ? { ...item, response: 'NOT_APPLICABLE' as const, updatedAt: '2027-01-26T09:00:00+09:00' }
              : item,
          ),
          version: scheduled.version + 1,
        })
        yield* scheduler.runFor(semiannual)
        const canceled = yield* january
        // 취소된 동안 1월 급여대장을 마감합니다. 급여대장 이벤트는 취소된 건을 건너뜁니다
        ledgers['2027-01'] = { ledgerCount: 1, closedCount: 1 }
        const result = yield* scheduler.runFor(DEMO_TAX_PROFILE)
        return [scheduled, canceled, result, yield* january] as const
      }).pipe(Effect.provide(TestClock.layer())),
      [],
      ledgers,
    )

    expect(requirement(scheduled, 'PAYROLL_LEDGER_CLOSED').response).toBe('PENDING')
    expect(canceled.status).toBe('CANCELED')
    expect(result.restored).toBeGreaterThan(0)
    expect(restored.status).toBe('SCHEDULED')
    expect(requirement(restored, 'PAYROLL_LEDGER_CLOSED')).toMatchObject({ autoLinked: true, response: 'PROVIDED' })
    expect(requirement(restored, 'BUSINESS_INCOME').response).toBe('NOT_APPLICABLE')
    expect(restored.history.slice(-2).map((entry) => entry.type)).toEqual(['SCHEDULE_RESTORED', 'REQUIREMENT_LINKED'])
    expect(restored.history.at(-1)!.detail).toEqual({ code: 'PAYROLL_LEDGER_CLOSED', response: 'PROVIDED' })
  })

  it('취소된 동안 급여대장 현황이 그대로면 체크리스트와 이력에 되살리기만 남깁니다', async () => {
    const restored = await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2027, 0, 26))
        const scheduler = yield* FilingScheduler
        const repository = yield* FilingRepository
        yield* scheduler.runFor(DEMO_TAX_PROFILE)
        yield* scheduler.runFor(semiannual)
        yield* scheduler.runFor(DEMO_TAX_PROFILE)
        return (yield* repository.list(TEST_COMPANY_ID)).find(
          (filing) => filing.taxType === 'WITHHOLDING_TAX' && filing.periodKey === '2027-01',
        )!
      }).pipe(Effect.provide(TestClock.layer())),
    )

    expect(restored.status).toBe('SCHEDULED')
    expect(restored.requirements[0]).toMatchObject({ code: 'PAYROLL_LEDGER_CLOSED', response: 'PROVIDED' })
    expect(restored.history.at(-1)!.type).toBe('SCHEDULE_RESTORED')
  })
})
