import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Plan } from '../../identity-access/actor.types.ts'
import {
  billingDate,
  isListedPayment,
  noticeDate,
  paymentTransition,
  plannedPayments,
  resultExpectedOn,
} from './payment-schedule.ts'
import type { PaymentEvent, PaymentStatus, ScheduledKey } from './payment-schedule.types.ts'

interface FixtureCase {
  name: string
  input: Record<string, unknown> & { check: string }
  expected: unknown
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/payment-schedule.json'), 'utf8'),
) as { cases: FixtureCase[] }

/** 서버로 옮기지 않는 케이스입니다. 화면 표시 문자열은 클라이언트 i18n 사전이 맡습니다. */
const NOT_PORTED = new Set(['status labels'])

const PLAN_OF: Record<string, Plan> = { tax: 'TAXATION', payroll: 'PAYROLL' }
const PRODUCT_NAME: Record<Plan, string> = { TAXATION: '세무 아웃소싱', PAYROLL: '급여 아웃소싱' }
const EVENT_OF: Record<string, PaymentEvent> = {
  withdrawalSucceeded: 'WITHDRAWAL_SUCCEEDED',
  withdrawalFailed: 'WITHDRAWAL_FAILED',
  retryByAgency: 'RETRY',
  refund: 'REFUND',
}

interface LegacySubscription {
  code: string
  status: 'active'
  startedOn: string
  endedOn: string | null
  monthlyFee: number
}

function run(input: FixtureCase['input']): unknown {
  switch (input.check) {
    case 'billingDate':
      return billingDate(input['month'] as string, new Set(input['holidays'] as string[]))
    case 'resultVisibleAt':
      return { date: resultExpectedOn(input['withdrawnOn'] as string), time: 'afternoon' }
    case 'noticeDate':
      return { date: noticeDate(input['withdrawalDate'] as string), channel: '알림톡' }
    case 'transition': {
      const next = paymentTransition(
        (input['from'] as string).toUpperCase() as PaymentStatus,
        EVENT_OF[input['event'] as string] as PaymentEvent,
      )
      return next === undefined ? { status: 409, code: 'INVALID_TRANSITION' } : next.toLowerCase()
    }
    case 'list':
      return (input['payments'] as { id: number; productCode: string; status: string }[])
        .filter((payment) => isListedPayment(PLAN_OF[payment.productCode] as Plan))
        .map((payment) => ({
          id: payment.id,
          productName: PRODUCT_NAME[PLAN_OF[payment.productCode] as Plan],
          isScheduled: payment.status === 'scheduled',
        }))
    case 'schedule': {
      const subscriptions = (input['subscriptions'] as LegacySubscription[]).map((row, index) => ({
        subscriptionId: `sub_${index}`,
        plan: PLAN_OF[row.code] as Plan,
        status: 'ACTIVE' as const,
        startsOn: row.startedOn,
        endsOn: row.endedOn ?? undefined,
        monthlyFee: row.monthlyFee,
      }))
      const existing: ScheduledKey[] = []
      const created = []
      for (let run = 0; run < ((input['runs'] as number | undefined) ?? 1); run += 1) {
        const items = plannedPayments({ month: input['month'] as string, subscriptions, existing, holidays: new Set() })
        existing.push(...items)
        created.push(...items)
      }
      return created.map((item) => ({
        code: Object.keys(PLAN_OF).find((code) => PLAN_OF[code] === item.plan),
        amount: item.amount,
        scheduledOn: item.scheduledOn,
        status: 'scheduled',
      }))
    }
    default:
      throw new Error(`unknown check ${input.check}`)
  }
}

describe('payment-schedule fixtures', () => {
  it.each(fixture.cases.filter((testCase) => !NOT_PORTED.has(testCase.name)))('$name', (testCase) => {
    expect(run(testCase.input)).toEqual(testCase.expected)
  })
})
