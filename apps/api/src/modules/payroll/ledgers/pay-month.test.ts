import { describe, expect, it } from 'vitest'
import type { LedgerStatus } from './ledger-status.types.ts'
import { withholdingTotalsPaidIn } from './pay-month.ts'
import type { PayrollLedgerRecord, PayrollRowRecord } from './payroll-ledger.types.ts'

function row(
  incomeType: string,
  payee: string,
  amounts: { grossPay: number; taxablePay: number; incomeTax: number; localIncomeTax: number } | null,
): PayrollRowRecord {
  return { employeeId: null, payeeName: payee, input: { incomeType }, result: amounts } as unknown as PayrollRowRecord
}

function ledger(paymentDate: string, status: LedgerStatus, rows: PayrollRowRecord[]): PayrollLedgerRecord {
  return { paymentDate, status, rows } as unknown as PayrollLedgerRecord
}

const MONTHLY_PAY = { grossPay: 3_200_000, taxablePay: 3_000_000, incomeTax: 60_380, localIncomeTax: 6_030 }
const LECTURE_FEE = { grossPay: 500_000, taxablePay: 200_000, incomeTax: 40_000, localIncomeTax: 4_000 }

describe('withholdingTotalsPaidIn', () => {
  it('지급월에 지급한 마감 대장의 행을 소득 종류별로 더합니다', () => {
    const ledgers = [
      ledger('2026-10-25', 'CLOSED', [row('WAGE_MONTHLY', '김근로', MONTHLY_PAY), row('OTHER', '이강사', LECTURE_FEE)]),
      ledger('2026-10-31', 'CLOSED', [row('WAGE_HOURLY', '박시급', MONTHLY_PAY)]),
    ]

    expect(withholdingTotalsPaidIn(ledgers, '2026-10')).toEqual([
      {
        incomeKind: 'WAGE',
        headcount: 2,
        grossPay: 6_400_000,
        taxablePay: 6_000_000,
        incomeTax: 120_760,
        localIncomeTax: 12_060,
      },
      { incomeKind: 'OTHER', headcount: 1, ...LECTURE_FEE },
    ])
  })

  it('마감 전 대장과 다른 지급월의 대장은 넣지 않습니다', () => {
    const ledgers = [
      ledger('2026-10-25', 'PENDING_APPROVAL', [row('WAGE_MONTHLY', '김근로', MONTHLY_PAY)]),
      ledger('2026-11-10', 'CLOSED', [row('DAILY', '최일용', MONTHLY_PAY)]),
    ]

    expect(withholdingTotalsPaidIn(ledgers, '2026-10')).toEqual([])
  })

  it('계산 결과가 없는 행은 건너뜁니다', () => {
    expect(
      withholdingTotalsPaidIn([ledger('2026-10-25', 'CLOSED', [row('BUSINESS', '정사업', null)])], '2026-10'),
    ).toEqual([])
  })
})
