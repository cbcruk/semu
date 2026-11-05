import { describe, expect, it } from 'vitest'
import type { LedgerStatus } from './ledger-status.types.ts'
import { countLedgersPaidBetween } from './payroll-ledger-summary.ts'
import type { PayrollLedgerRecord } from './payroll-ledger.types.ts'

function ledger(paymentDate: string, status: LedgerStatus): PayrollLedgerRecord {
  return { paymentDate, status } as unknown as PayrollLedgerRecord
}

describe('countLedgersPaidBetween', () => {
  it('counts ledgers paid inside the range, both ends included', () => {
    const ledgers = [
      ledger('2026-02-01', 'CLOSED'),
      ledger('2026-02-25', 'PENDING_APPROVAL'),
      ledger('2026-02-28', 'CLOSED'),
      ledger('2026-03-01', 'CLOSED'),
    ]
    expect(countLedgersPaidBetween(ledgers, '2026-02-01', '2026-02-28')).toEqual({ ledgerCount: 3, closedCount: 2 })
  })

  it('is empty when nothing is paid in the range', () => {
    expect(countLedgersPaidBetween([ledger('2026-01-25', 'CLOSED')], '2026-02-01', '2026-02-28')).toEqual({
      ledgerCount: 0,
      closedCount: 0,
    })
  })
})
