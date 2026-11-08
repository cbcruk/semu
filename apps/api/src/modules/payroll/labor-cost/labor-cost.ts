import { countsAsCalculated } from '../ledgers/ledger-status.ts'
import { withholdingKindOf } from '../ledgers/pay-month.ts'
import type { PayrollLedgerRecord } from '../ledgers/payroll-ledger.types.ts'
import type { WithholdingIncomeKind } from '../ports/payroll-events.types.ts'
import type { AmountsByKind, LaborCostMonth, LaborCostReport, LaborCostRow } from './labor-cost.types.ts'

const 소득구분키: Record<WithholdingIncomeKind, keyof AmountsByKind> = {
  WAGE: 'wage',
  DAILY: 'daily',
  BUSINESS: 'business',
  OTHER: 'other',
}

/**
 * 대장에서 인건비 집계 행을 뽑습니다. 현행처럼 계산 확정(`SUBMITTED`) 이후 대장만 넣으므로,
 * 입력 중으로 되돌린 대장은 다시 제출할 때까지 빠집니다. 추가 대장은 같은 귀속월에 더합니다.
 */
export function laborCostRowsOf(ledgers: readonly PayrollLedgerRecord[], year: number): LaborCostRow[] {
  return ledgers
    .filter((ledger) => countsAsCalculated(ledger.status) && ledger.attributionMonth.startsWith(`${year}-`))
    .flatMap((ledger) =>
      ledger.rows.flatMap((row) =>
        row.result === null
          ? []
          : [
              {
                attributionMonth: ledger.attributionMonth,
                incomeKind: withholdingKindOf(row.input.incomeType),
                payeeKey: row.employeeId ?? `name:${row.payeeName}`,
                grossPay: row.result.grossPay,
                employerInsurance: row.result.employerInsurance.total,
                calculatedAt: ledger.calculatedAt,
              },
            ],
      ),
    )
}

/**
 * 한 해의 인건비 보고서를 만듭니다. 금액은 귀속월 기준 세전 지급액이고 사업주 부담 4대보험을 따로 더합니다.
 *
 * @param employment 월(`YYYY-MM`)별 HR 재직 추이입니다.
 */
export function buildLaborCost(
  rows: readonly LaborCostRow[],
  year: number,
  employment: ReadonlyMap<string, { employed: number; joined: number; left: number }>,
): LaborCostReport {
  const 빈금액 = (): AmountsByKind => ({ wage: 0, daily: 0, business: 0, other: 0 })
  const 연간소득자 = {
    wage: new Set<string>(),
    daily: new Set<string>(),
    business: new Set<string>(),
    other: new Set<string>(),
  }
  const months: LaborCostMonth[] = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`
    const amounts = 빈금액()
    const 월소득자 = {
      wage: new Set<string>(),
      daily: new Set<string>(),
      business: new Set<string>(),
      other: new Set<string>(),
    }
    let 사업주보험료 = 0
    for (const row of rows.filter((candidate) => candidate.attributionMonth === month)) {
      const 금액키 = 소득구분키[row.incomeKind]
      amounts[금액키] += row.grossPay
      사업주보험료 += row.employerInsurance
      월소득자[금액키].add(row.payeeKey)
      연간소득자[금액키].add(row.payeeKey)
    }
    const 지급총액 = amounts.wage + amounts.daily + amounts.business + amounts.other
    return {
      month,
      amounts,
      total: 지급총액,
      employerInsurance: 사업주보험료,
      totalWithEmployerInsurance: 지급총액 + 사업주보험료,
      headcount: {
        wage: 월소득자.wage.size,
        daily: 월소득자.daily.size,
        business: 월소득자.business.size,
        other: 월소득자.other.size,
      },
      employment: employment.get(month) ?? { employed: 0, joined: 0, left: 0 },
    }
  })
  const 연합계 = (pick: (month: LaborCostMonth) => number) => months.reduce((sum, month) => sum + pick(month), 0)
  const updatedAt = rows.reduce<string | null>(
    (latest, row) =>
      row.calculatedAt !== null && (latest === null || row.calculatedAt > latest) ? row.calculatedAt : latest,
    null,
  )
  return {
    year,
    hasData: rows.length > 0,
    months,
    totals: {
      amounts: {
        wage: 연합계((month) => month.amounts.wage),
        daily: 연합계((month) => month.amounts.daily),
        business: 연합계((month) => month.amounts.business),
        other: 연합계((month) => month.amounts.other),
      },
      total: 연합계((month) => month.total),
      employerInsurance: 연합계((month) => month.employerInsurance),
      totalWithEmployerInsurance: 연합계((month) => month.totalWithEmployerInsurance),
      headcount: {
        wage: 연간소득자.wage.size,
        daily: 연간소득자.daily.size,
        business: 연간소득자.business.size,
        other: 연간소득자.other.size,
      },
    },
    updatedAt,
  }
}
