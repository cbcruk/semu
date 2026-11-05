import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { loadRuleCases } from '../payroll-fixture-loader.ts'
import { additionalLedgerBlocker, duplicatedWageIncome, type LedgerSummary, type WageRowRef } from './ledger-rules.ts'
import { decideTransition } from './ledger-status.ts'
import type { LedgerStatus, LedgerTransition, LedgerTransitionContext } from './ledger-status.types.ts'
import { isPayMonthClosed } from './pay-month.ts'
import type { PayrollLedgerRecord } from './payroll-ledger.types.ts'

describe('rule fixture: payroll-ledger-transitions', () => {
  type Input = LedgerTransitionContext & { transition: LedgerTransition }
  it.each(loadRuleCases<Input, Record<string, unknown>>('payroll-ledger-transitions'))(
    '$name',
    ({ input, expected }) => {
      const { transition, ...context } = input
      expect(decideTransition(transition, context)).toEqual(expected)
    },
  )
})

describe('rule fixture: additional-payroll-ledger', () => {
  type Input = {
    attributionMonth: string
    paymentDate: string
    today: string
    ledgers: LedgerSummary[]
    withholdingFiled: boolean
  }
  it.each(loadRuleCases<Input, { blocker: string | null }>('additional-payroll-ledger'))(
    '$name',
    ({ input, expected }) => {
      expect(additionalLedgerBlocker(input)).toBe(expected.blocker)
    },
  )
})

describe('rule fixture: duplicate-wage-income', () => {
  type Input = {
    ledgerKind: 'REGULAR' | 'ADDITIONAL'
    existing: WageRowRef[]
    candidate: { attributionMonth: string; employeeId: string }
  }
  it.each(loadRuleCases<Input, { error: string | null }>('duplicate-wage-income'))('$name', ({ input, expected }) => {
    const error =
      input.ledgerKind === 'ADDITIONAL'
        ? 'WAGE_ROW_ON_ADDITIONAL_LEDGER'
        : duplicatedWageIncome(input.existing, input.candidate) === null
          ? null
          : 'WAGE_INCOME_DUPLICATED'
    expect(error).toBe(expected.error)
  })
})

describe('rule fixture: withholding-ledger-closed', () => {
  type Input = { paymentMonth: string; ledgers: { paymentDate: string; status: LedgerStatus }[] }
  it.each(loadRuleCases<Input, { closed: boolean }>('withholding-ledger-closed'))('$name', ({ input, expected }) => {
    const ledgers = input.ledgers.map(
      (ledger, index) =>
        ({
          ...ledger,
          id: `pyl_${index}` as Id<'payrollLedger'>,
          rows: [],
        }) as unknown as PayrollLedgerRecord,
    )
    expect(isPayMonthClosed(ledgers, input.paymentMonth)).toBe(expected.closed)
  })
})
