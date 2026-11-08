import { describe, expect, it } from 'vitest'
import type { PayrollRowInputValue } from '../rows/payroll-row-input.ts'
import type { SeveranceSettlementRecord } from '../severance/severance-settlement.types.ts'
import type { LedgerStatus } from './ledger-status.types.ts'
import { ledgerMonthsTouched, otherIncomeCategoryOf, withholdingTotalsPaidIn } from './pay-month.ts'
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

  it('지급일이 그 달인 완료 퇴직금 정산을 퇴직소득 줄로 일용과 사업 사이에 넣습니다', () => {
    const ledgers = [
      ledger('2026-10-25', 'CLOSED', [
        row({ incomeType: 'BUSINESS' }, '정사업', MONTHLY_PAY),
        row({ incomeType: 'DAILY' }, '최일용', MONTHLY_PAY),
      ]),
    ]
    const settlements = [
      {
        employeeId: 'emp_a',
        status: 'COMPLETED',
        paymentDate: '2026-10-31',
        result: { severancePay: 8_321_917, retirementIncomeTax: 79_720, localIncomeTax: 7_970 },
      },
    ] as unknown as SeveranceSettlementRecord[]

    expect(withholdingTotalsPaidIn(ledgers, '2026-10', settlements).map((line) => line.incomeKind)).toEqual([
      'DAILY',
      'RETIREMENT',
      'BUSINESS',
    ])
    // 대장이 없는 달에도 퇴직소득 줄은 나옵니다.
    expect(withholdingTotalsPaidIn([], '2026-10', settlements)).toEqual([
      {
        incomeKind: 'RETIREMENT',
        otherIncomeCategory: null,
        headcount: 1,
        grossPay: 8_321_917,
        taxablePay: 8_321_917,
        incomeTax: 79_720,
        localIncomeTax: 7_970,
      },
    ])
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

describe('ledgerMonthsTouched', () => {
  it('마감 전 대장의 지급일을 다른 달로 옮기면 옮겨 갈 달만 잠금 대상으로 봅니다', () => {
    expect(ledgerMonthsTouched(ledger('2026-05-25', 'DRAFT', []), ledger('2026-06-10', 'DRAFT', []))).toEqual([
      '2026-06',
    ])
    expect(ledgerMonthsTouched(ledger('2026-05-25', 'SUBMITTED', []), ledger('2026-04-30', 'SUBMITTED', []))).toEqual([
      '2026-04',
    ])
  })

  it('마감한 대장을 옮기면 원래 달과 옮겨 갈 달을 모두 봅니다', () => {
    expect(ledgerMonthsTouched(ledger('2026-05-25', 'CLOSED', []), ledger('2026-06-10', 'CLOSED', []))).toEqual([
      '2026-05',
      '2026-06',
    ])
  })

  it('제목만 고치거나 같은 달 안에서 지급일을 바꾸면 그 달을 봅니다', () => {
    expect(ledgerMonthsTouched(ledger('2026-05-25', 'DRAFT', []), ledger('2026-05-25', 'DRAFT', []))).toEqual([
      '2026-05',
    ])
    expect(ledgerMonthsTouched(ledger('2026-05-25', 'DRAFT', []), ledger('2026-05-31', 'DRAFT', []))).toEqual([
      '2026-05',
    ])
  })
})
