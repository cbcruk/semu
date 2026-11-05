import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { FilingRepository } from '../filings/filing-repository.ts'
import { DEMO_TAX_PROFILE } from '../tax-demo.ts'
import { FilingSchedulerLive, taxMemoryLayer } from '../tax.layer.ts'
import type { TaxEvent } from '../tax.public.ts'
import { FilingScheduler } from './filing-scheduler.ts'
import type { TaxProfile } from './tax-profiles.ts'

function run<A>(effect: Effect.Effect<A, never, FilingScheduler | FilingRepository>, events: TaxEvent[] = []) {
  const memory = taxMemoryLayer({
    profiles: [DEMO_TAX_PROFILE],
    payrollLedgers: Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => {
        const date = new Date(Date.UTC(2026, index, 1)).toISOString().slice(0, 7)
        return [date, { ledgerCount: 1, closedCount: 1 }]
      }),
    ),
    events,
  })
  return Effect.runPromise(effect.pipe(Effect.provide(Layer.provideMerge(FilingSchedulerLive, memory))))
}

const semiannual: TaxProfile = { ...DEMO_TAX_PROFILE, withholdingCycle: 'SEMIANNUAL' }

describe('FilingScheduler', () => {
  it('creates the upcoming filings once and changes nothing on a rerun', async () => {
    const [first, second, filings] = await run(
      Effect.gen(function* () {
        const scheduler = yield* FilingScheduler
        const repository = yield* FilingRepository
        return [yield* scheduler.run(), yield* scheduler.run(), yield* repository.list(TEST_COMPANY_ID)] as const
      }),
    )

    expect(first.created).toBeGreaterThan(0)
    expect(second).toEqual({ created: 0, refreshed: 0, canceled: 0 })
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

  it('cancels scheduled monthly withholding after the switch to semiannual payment', async () => {
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
