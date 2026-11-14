import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { Scheduler } from '../../../shared/scheduler/scheduler.ts'
import { PAYROLL_DEMO_COMPANY_ID } from '../payroll-demo.ts'
import { PayrollMemoryLive } from '../payroll.layer.ts'
import { PayrollPlanCheck } from '../ports/payroll-plan-check.ts'
import { defaultPayrollSetting } from '../settings/payroll-setting.ts'
import { PayrollSettingRepository } from '../settings/payroll-setting-repository.ts'
import { PayrollLedgerRepository } from './payroll-ledger-repository.ts'
import { regularLedgerTask } from './regular-ledger-task.ts'

const NO_PLAN = 'cmp_01JBQ00000000000000000000N' as Id<'company'>
const OFF = 'cmp_01JBQ00000000000000000000F' as Id<'company'>

describe('정기 작업 payroll.regular-ledger', () => {
  it('자동 생성을 켜고 급여대장 플랜이 있는 회사에 임금산정 기간이 시작한 귀속월의 정기 대장을 귀속월마다 한 번 만듭니다', async () => {
    const on = { ...defaultPayrollSetting(), wagePeriodStartDay: 16, autoCreateRegularLedger: true }
    const layer = Scheduler.layer([regularLedgerTask]).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          PayrollMemoryLive,
          PayrollSettingRepository.layerMemory([
            { companyId: PAYROLL_DEMO_COMPANY_ID, setting: on },
            { companyId: NO_PLAN, setting: on },
            { companyId: OFF, setting: defaultPayrollSetting() },
          ]),
          PayrollPlanCheck.layerMemory([
            [PAYROLL_DEMO_COMPANY_ID, ['PAYROLL']],
            [OFF, ['PAYROLL']],
          ]),
        ),
      ),
      Layer.provideMerge(Layer.merge(TableFactory.layerMemory, UnitOfWork.layerNone)),
    )

    const { runs, ledgers, others } = await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler
        yield* TestClock.setTime(Date.parse('2026-11-15T04:00:00+09:00'))
        yield* scheduler.runDue()
        yield* TestClock.setTime(Date.parse('2026-11-16T04:00:00+09:00'))
        yield* scheduler.runDue()
        yield* TestClock.setTime(Date.parse('2026-11-17T04:00:00+09:00'))
        yield* scheduler.runDue()
        const repository = yield* PayrollLedgerRepository
        return {
          runs: yield* scheduler.runs(),
          ledgers: yield* repository.list(PAYROLL_DEMO_COMPANY_ID),
          others: [...(yield* repository.list(NO_PLAN)), ...(yield* repository.list(OFF))],
        }
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    )

    expect(runs.map((run) => [run.slot, run.result])).toEqual([
      ['2026-11-17T04:00', { companies: 2, EXISTS: 1, NO_PLAN: 1 }],
      ['2026-11-16T04:00', { companies: 2, CREATED: 1, NO_PLAN: 1 }],
      ['2026-11-15T04:00', { companies: 2, CREATED: 1, NO_PLAN: 1 }],
    ])
    expect(ledgers.map((ledger) => ledger.attributionMonth)).toEqual(['2026-10', '2026-11'])
    expect(ledgers[0]).toMatchObject({
      kind: 'REGULAR',
      status: 'DRAFT',
      attributionMonth: '2026-10',
      wagePeriod: { start: '2026-10-16', end: '2026-11-15' },
      paymentDate: '2026-10-25',
    })
    expect(ledgers[0]?.rows.length).toBeGreaterThan(0)
    expect(others).toEqual([])
  })
})
