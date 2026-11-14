import { describe, expect, it } from 'vitest'
import { monthsBetween, withholdingLineCodeOf, withholdingReturnLines } from './withholding-return.ts'
import type { OtherIncomeCategory, WithholdingIncomeKind, WithholdingTotal } from './withholding-return.types.ts'

function total(
  incomeKind: WithholdingIncomeKind,
  incomeTax: number,
  otherIncomeCategory: OtherIncomeCategory | null = null,
): WithholdingTotal {
  return {
    incomeKind,
    otherIncomeCategory,
    headcount: 1,
    grossPay: incomeTax * 10,
    taxablePay: incomeTax * 10,
    incomeTax,
    localIncomeTax: incomeTax / 10,
  }
}

describe('withholdingLineCodeOf', () => {
  it.each([
    ['WAGE', null, 'A01', 'A10'],
    ['WAGE_MID_YEAR_SETTLEMENT', null, 'A02', 'A10'],
    ['DAILY', null, 'A03', 'A10'],
    ['WAGE_ANNUAL_SETTLEMENT', null, 'A04', 'A10'],
    ['RETIREMENT', null, 'A22', 'A20'],
    ['BUSINESS', null, 'A25', 'A30'],
    ['OTHER', 'PERSONAL_SERVICE', 'A59', 'A40'],
    ['OTHER', 'GENERAL', 'A42', 'A40'],
  ] as const)(
    '%s(%s) 소득은 신고서 %s 줄에 적고 %s 가감계로 모읍니다',
    (incomeKind, category, lineCode, subtotalCode) => {
      expect(withholdingLineCodeOf(incomeKind, category)).toEqual({ lineCode, subtotalCode })
    },
  )

  it('구분을 모르는 기타소득은 그 외(A42) 줄입니다', () => {
    expect(withholdingLineCodeOf('OTHER')).toEqual({ lineCode: 'A42', subtotalCode: 'A40' })
  })
})

describe('withholdingReturnLines', () => {
  it('합계에 줄 코드를 붙이고 서식의 줄 순서로 늘어놓습니다(인적용역 A59가 그 외 A42보다 위)', () => {
    const lines = withholdingReturnLines([
      total('OTHER', 4_000, 'GENERAL'),
      total('WAGE', 60_000),
      total('OTHER', 8_000, 'PERSONAL_SERVICE'),
      total('BUSINESS', 30_000),
    ])

    expect(lines.map((line) => [line.lineCode, line.incomeKind, line.incomeTax])).toEqual([
      ['A01', 'WAGE', 60_000],
      ['A25', 'BUSINESS', 30_000],
      ['A59', 'OTHER', 8_000],
      ['A42', 'OTHER', 4_000],
    ])
  })

  it('근로소득 정산 줄은 간이세액(A01)과 일용근로(A03) 사이·뒤에 두고 환급(음수) 세액도 그대로 옮깁니다', () => {
    const lines = withholdingReturnLines([
      total('WAGE_ANNUAL_SETTLEMENT', -50_000),
      total('DAILY', 1_200),
      total('WAGE_MID_YEAR_SETTLEMENT', -220_000),
      total('WAGE', 60_000),
    ])

    expect(lines.map((line) => [line.lineCode, line.incomeKind, line.incomeTax])).toEqual([
      ['A01', 'WAGE', 60_000],
      ['A02', 'WAGE_MID_YEAR_SETTLEMENT', -220_000],
      ['A03', 'DAILY', 1_200],
      ['A04', 'WAGE_ANNUAL_SETTLEMENT', -50_000],
    ])
  })

  it('금액은 바꾸지 않고 그대로 옮깁니다', () => {
    expect(withholdingReturnLines([total('DAILY', 1_200)])).toEqual([
      { lineCode: 'A03', subtotalCode: 'A10', ...total('DAILY', 1_200) },
    ])
  })

  it('합계가 없으면 줄도 없습니다', () => {
    expect(withholdingReturnLines([])).toEqual([])
  })
})

describe('monthsBetween', () => {
  it('매월 신고 기간은 그 달 하나입니다', () => {
    expect(monthsBetween('2026-10-01', '2026-10-31')).toEqual(['2026-10'])
  })

  it('반기 신고 기간은 여섯 달이고 해를 넘겨도 이어집니다', () => {
    expect(monthsBetween('2026-07-01', '2026-12-31')).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ])
    expect(monthsBetween('2026-12-01', '2027-01-31')).toEqual(['2026-12', '2027-01'])
  })
})
