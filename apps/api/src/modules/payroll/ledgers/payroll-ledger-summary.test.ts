import { describe, expect, it } from 'vitest'
import type { LedgerStatus } from './ledger-status.types.ts'
import { countLedgersPaidBetween } from './payroll-ledger-summary.ts'
import type { PayrollLedgerRecord } from './payroll-ledger.types.ts'

function ledger(paymentDate: string, status: LedgerStatus): PayrollLedgerRecord {
  return { paymentDate, status } as unknown as PayrollLedgerRecord
}

describe('countLedgersPaidBetween', () => {
  it('기간 안에 지급한 급여대장을 셉니다(시작일·종료일 포함)', () => {
    const ledgers = [
      ledger('2026-02-01', 'CLOSED'),
      ledger('2026-02-25', 'PENDING_APPROVAL'),
      ledger('2026-02-28', 'CLOSED'),
      ledger('2026-03-01', 'CLOSED'),
    ]
    expect(countLedgersPaidBetween(ledgers, '2026-02-01', '2026-02-28')).toEqual({ ledgerCount: 3, closedCount: 2 })
  })

  it('기간 안에 지급한 대장이 없으면 비어 있습니다', () => {
    expect(countLedgersPaidBetween([ledger('2026-01-25', 'CLOSED')], '2026-02-01', '2026-02-28')).toEqual({
      ledgerCount: 0,
      closedCount: 0,
    })
  })
})
