import { describe, expect, it } from 'vitest'
import type { PayrollRowInputValue } from '../rows/payroll-row-input.ts'
import type { LedgerStatus } from './ledger-status.types.ts'
import { otherIncomeCategoryOf, withholdingTotalsPaidIn } from './pay-month.ts'
import type { PayrollLedgerRecord, PayrollRowRecord } from './payroll-ledger.types.ts'

function row(
  input: { incomeType: string; otherIncomeCode?: string },
  payee: string,
  amounts: { grossPay: number; taxablePay: number; incomeTax: number; localIncomeTax: number } | null,
): PayrollRowRecord {
  return { employeeId: null, payeeName: payee, input, result: amounts } as unknown as PayrollRowRecord
}

function ledger(paymentDate: string, status: LedgerStatus, rows: PayrollRowRecord[]): PayrollLedgerRecord {
  return { paymentDate, status, rows } as unknown as PayrollLedgerRecord
}

const MONTHLY_PAY = { grossPay: 3_200_000, taxablePay: 3_000_000, incomeTax: 60_380, localIncomeTax: 6_030 }
const LECTURE_FEE = { grossPay: 500_000, taxablePay: 200_000, incomeTax: 40_000, localIncomeTax: 4_000 }
const PRIZE = { grossPay: 1_000_000, taxablePay: 200_000, incomeTax: 40_000, localIncomeTax: 4_000 }

describe('withholdingTotalsPaidIn', () => {
  it('지급월에 지급한 마감 대장의 행을 소득 종류별로 더합니다', () => {
    const ledgers = [
      ledger('2026-10-25', 'CLOSED', [
        row({ incomeType: 'WAGE_MONTHLY' }, '김근로', MONTHLY_PAY),
        row({ incomeType: 'OTHER' }, '이강사', LECTURE_FEE),
      ]),
      ledger('2026-10-31', 'CLOSED', [row({ incomeType: 'WAGE_HOURLY' }, '박시급', MONTHLY_PAY)]),
    ]

    expect(withholdingTotalsPaidIn(ledgers, '2026-10')).toEqual([
      {
        incomeKind: 'WAGE',
        otherIncomeCategory: null,
        headcount: 2,
        grossPay: 6_400_000,
        taxablePay: 6_000_000,
        incomeTax: 120_760,
        localIncomeTax: 12_060,
      },
      { incomeKind: 'OTHER', otherIncomeCategory: 'PERSONAL_SERVICE', headcount: 1, ...LECTURE_FEE },
    ])
  })

  it('기타소득은 인적용역과 그 밖의 기타소득을 따로 더하고 인적용역을 앞에 둡니다', () => {
    const ledgers = [
      ledger('2026-10-25', 'CLOSED', [
        row({ incomeType: 'OTHER', otherIncomeCode: '71' }, '최수상', PRIZE),
        row({ incomeType: 'OTHER', otherIncomeCode: '79' }, '정자문', LECTURE_FEE),
        row({ incomeType: 'OTHER', otherIncomeCode: '76' }, '이강사', LECTURE_FEE),
      ]),
    ]

    expect(withholdingTotalsPaidIn(ledgers, '2026-10')).toEqual([
      {
        incomeKind: 'OTHER',
        otherIncomeCategory: 'PERSONAL_SERVICE',
        headcount: 2,
        grossPay: 1_000_000,
        taxablePay: 400_000,
        incomeTax: 80_000,
        localIncomeTax: 8_000,
      },
      { incomeKind: 'OTHER', otherIncomeCategory: 'GENERAL', headcount: 1, ...PRIZE },
    ])
  })

  it('마감 전 대장과 다른 지급월의 대장은 넣지 않습니다', () => {
    const ledgers = [
      ledger('2026-10-25', 'PENDING_APPROVAL', [row({ incomeType: 'WAGE_MONTHLY' }, '김근로', MONTHLY_PAY)]),
      ledger('2026-11-10', 'CLOSED', [row({ incomeType: 'DAILY' }, '최일용', MONTHLY_PAY)]),
    ]

    expect(withholdingTotalsPaidIn(ledgers, '2026-10')).toEqual([])
  })

  it('계산 결과가 없는 행은 건너뜁니다', () => {
    expect(
      withholdingTotalsPaidIn(
        [ledger('2026-10-25', 'CLOSED', [row({ incomeType: 'BUSINESS' }, '정사업', null)])],
        '2026-10',
      ),
    ).toEqual([])
  })
})

describe('otherIncomeCategoryOf', () => {
  it.each([
    ['76', 'PERSONAL_SERVICE'],
    ['79', 'PERSONAL_SERVICE'],
    ['75', 'GENERAL'],
    ['71', 'GENERAL'],
    ['62', 'GENERAL'],
  ] as const)('지급사유 %s 기타소득은 %s입니다', (otherIncomeCode, category) => {
    expect(otherIncomeCategoryOf({ incomeType: 'OTHER', otherIncomeCode } as PayrollRowInputValue)).toBe(category)
  })

  it('지급사유가 없으면 기본값 76(강연료등)이라 인적용역입니다', () => {
    expect(otherIncomeCategoryOf({ incomeType: 'OTHER' } as PayrollRowInputValue)).toBe('PERSONAL_SERVICE')
  })

  it('기타소득이 아니면 구분이 없습니다', () => {
    expect(otherIncomeCategoryOf({ incomeType: 'BUSINESS' } as PayrollRowInputValue)).toBeNull()
  })
})
