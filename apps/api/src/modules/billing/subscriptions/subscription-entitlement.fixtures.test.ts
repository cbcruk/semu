import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Plan } from '../../identity-access/actor.types.ts'
import { entitledPlans, isEntitledOn, isFreeOn, refreshedStatus } from './subscription-entitlement.ts'
import type { SubscriptionStatus, SubscriptionTerm } from './subscription-entitlement.types.ts'

interface LegacyRow {
  code: string
  status: 'pending' | 'active' | 'cancelled' | 'ended'
  startedOn: string
  endedOn: string | null
}

interface FixtureCase {
  name: string
  input: {
    check: string
    subscriptions?: { code: string; isSubscribed: boolean }[]
    row?: LegacyRow
    rows?: LegacyRow[]
    today?: string
  }
  expected: unknown
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/subscription-entitlement.json'), 'utf8'),
) as { cases: FixtureCase[] }

const PLAN_OF: Record<string, Plan | undefined> = { tax: 'TAXATION', payroll: 'PAYROLL' }
const STATUS_OF: Record<LegacyRow['status'], SubscriptionStatus> = {
  pending: 'PENDING',
  active: 'ACTIVE',
  cancelled: 'CANCELLATION_SCHEDULED',
  ended: 'ENDED',
}

/** 현행 기대값과 다르게 판정하는 케이스입니다. 이유는 `docs/design/rule-decisions/billing.md`에 있습니다. */
const CHANGED: Record<string, unknown> = {
  'unknown subscribed code is neither free nor a plan': { hasTaxPlan: false, hasPayrollPlan: false, isFree: true },
  'pending even after the start date': true,
}

function term(row: LegacyRow): SubscriptionTerm {
  return {
    plan: PLAN_OF[row.code] ?? 'TAXATION',
    status: STATUS_OF[row.status],
    startsOn: row.startedOn,
    endsOn: row.endedOn ?? undefined,
  }
}

function flags(plans: ReadonlyArray<Plan>): { hasTaxPlan: boolean; hasPayrollPlan: boolean; isFree: boolean } {
  return {
    hasTaxPlan: plans.includes('TAXATION'),
    hasPayrollPlan: plans.includes('PAYROLL'),
    isFree: plans.length === 0,
  }
}

function run(input: FixtureCase['input']): unknown {
  const today = input.today ?? '2026-11-05'
  switch (input.check) {
    case 'clientFlags': {
      const plans = (input.subscriptions ?? [])
        .filter((item) => item.isSubscribed)
        .flatMap((item) => (PLAN_OF[item.code] === undefined ? [] : [PLAN_OF[item.code] as Plan]))
      return flags([...new Set(plans)])
    }
    case 'isSubscribedOn':
      return isEntitledOn(term(input.row as LegacyRow), today)
    case 'taxPlanCache': {
      const plans = entitledPlans((input.rows ?? []).map(term), today)
      return { taxPlan: plans.includes('TAXATION') ? 'taxation' : null, hasPayrollPlan: plans.includes('PAYROLL') }
    }
    case 'dailyRefresh': {
      const row = term(input.row as LegacyRow)
      const status = refreshedStatus(row, today)
      const legacyStatus = Object.entries(STATUS_OF).find(([, value]) => value === status)?.[0]
      const plans = entitledPlans([row], today)
      return row.plan === 'TAXATION'
        ? { status: legacyStatus, taxPlan: plans.includes('TAXATION') ? 'taxation' : null }
        : { status: legacyStatus, hasPayrollPlan: plans.includes('PAYROLL') }
    }
    default:
      throw new Error(`unknown check ${input.check}`)
  }
}

describe('subscription-entitlement 픽스처', () => {
  it.each(fixture.cases)('$name', (testCase) => {
    const expected = testCase.name in CHANGED ? CHANGED[testCase.name] : testCase.expected

    expect(run(testCase.input)).toEqual(expected)
  })

  it('유료 플랜이 하나도 없으면 무료 고객입니다', () => {
    expect(isFreeOn([], '2026-11-05')).toBe(true)
  })
})
