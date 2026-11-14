import { lastDayOfMonth } from '../../../shared/time/calendar.ts'
import { truncateTo } from '../engine/engine-math.ts'
import type { PayrollRateTable, RoundingUnit } from '../engine/rate-table.types.ts'
import {
  earnedIncomeCreditOf,
  earnedIncomeDeductionOf,
  localIncomeTaxOf,
  progressiveTax,
} from '../engine/wage-income-tax.ts'
import { withholdingKindOf } from '../ledgers/pay-month.ts'
import type { WithholdingSummaryLine } from '../ledgers/pay-month.types.ts'
import type { PayrollLedgerRecord } from '../ledgers/payroll-ledger.types.ts'
import type {
  WageSettlementInput,
  WageSettlementKind,
  WageSettlementResult,
  WageTaxSettlementRecord,
  WageYearTotals,
} from './wage-tax-settlement.types.ts'

/**
 * 그해(`YYYY`) 귀속인 그 직원의 근로소득을 마감된 급여대장에서 모읍니다.
 *
 * 마감(`CLOSED`)한 대장의 근로 행(간이세액 대상)만 셉니다. 일용근로는 분리과세라 연말정산하지 않고, 마감 전 대장은 아직 바뀔 수 있습니다.
 * 귀속월은 대장의 `attributionMonth`입니다.
 */
export function wageYearTotalsOf(
  ledgers: readonly PayrollLedgerRecord[],
  employeeId: string,
  year: string,
): WageYearTotals {
  const 대장들 = ledgers.filter(
    (ledger) => ledger.status === 'CLOSED' && ledger.attributionMonth.startsWith(`${year}-`),
  )
  const 결과들 = 대장들.flatMap((ledger) =>
    ledger.rows
      .filter((row) => row.employeeId === employeeId && withholdingKindOf(row.input.incomeType) === 'WAGE')
      .flatMap((row) => (row.result === null ? [] : [{ month: ledger.attributionMonth, result: row.result }])),
  )
  const 합 = (pick: (result: (typeof 결과들)[number]['result']) => number) =>
    결과들.reduce((total, { result }) => total + pick(result), 0)
  return {
    months: [...new Set(결과들.map(({ month }) => month))].toSorted(),
    grossPay: 합((result) => result.grossPay),
    taxablePay: 합((result) => result.taxablePay),
    nationalPension: 합((result) => result.employeeInsurance.nationalPension),
    healthInsurance: 합((result) => result.employeeInsurance.healthInsurance + result.employeeInsurance.longTermCare),
    employmentInsurance: 합((result) => result.employeeInsurance.employmentInsurance),
    withheldIncomeTax: 합((result) => result.incomeTax),
    withheldLocalIncomeTax: 합((result) => result.localIncomeTax),
  }
}

/** 근로소득 정산을 만들 수 없는 까닭입니다. */
export type WageSettlementRejection =
  'NOT_LEFT_IN_YEAR' | 'YEAR_NOT_ENDED' | 'NOT_EMPLOYED_AT_YEAR_END' | 'NO_WAGE_IN_YEAR'

/**
 * 근로소득 정산을 만들 수 있는지 판정합니다. 만들 수 있으면 `null`입니다.
 *
 * - 중도퇴사(`MID_YEAR`)는 그해 12월 31일 전에 퇴사한 직원만 받습니다. 12월 31일 퇴사자는 연말정산 대상입니다
 * - 연말정산(`ANNUAL`)은 그해가 끝난 뒤, 12월 31일에 재직한 직원만 받습니다
 * - 그해 마감된 대장에 근로 행이 없으면 정산할 소득이 없습니다
 */
export function wageSettlementRejectionOf(input: {
  readonly kind: WageSettlementKind
  readonly year: string
  readonly joinDate: string
  readonly leaveDate: string | null
  readonly today: string
  readonly totals: WageYearTotals
}): WageSettlementRejection | null {
  const 연말 = `${input.year}-12-31`
  if (input.kind === 'MID_YEAR') {
    if (input.leaveDate === null || !input.leaveDate.startsWith(`${input.year}-`) || input.leaveDate >= 연말) {
      return 'NOT_LEFT_IN_YEAR'
    }
  } else {
    if (input.today <= 연말) return 'YEAR_NOT_ENDED'
    if (input.joinDate > 연말 || (input.leaveDate !== null && input.leaveDate < 연말)) return 'NOT_EMPLOYED_AT_YEAR_END'
  }
  return input.totals.months.length === 0 ? 'NO_WAGE_IN_YEAR' : null
}

/**
 * 정산 세액을 원천세에 넣는 지급일의 기본값입니다. 중도퇴사는 퇴사일, 연말정산은 다음 해 2월 말일입니다
 * (연말정산은 다음 해 2월분 급여를 줄 때 합니다, 소득세법 제137조).
 */
export function defaultSettlementPaymentDate(kind: WageSettlementKind, year: string, leaveDate: string | null): string {
  if (kind === 'MID_YEAR' && leaveDate !== null) return leaveDate
  return lastDayOfMonth(`${String(Number(year) + 1)}-02`)
}

/** 정산 지급일로 받을 수 있는 가장 이른 날입니다. 중도퇴사는 그해 1월 1일, 연말정산은 다음 해 1월 1일입니다. */
export function earliestSettlementPaymentDate(kind: WageSettlementKind, year: string): string {
  return kind === 'MID_YEAR' ? `${year}-01-01` : `${String(Number(year) + 1)}-01-01`
}

/**
 * 한 해 근로소득의 결정세액과 차감징수세액을 계산합니다.
 *
 * 단계: 총급여 → 근로소득공제(한도) → 근로소득금액 → 인적공제(기본공제 1인 150만원 × 공제대상가족) → 연금보험료공제(국민연금
 * 근로자 부담분) → 보험료 특별소득공제(건강·장기요양·고용보험료 근로자 부담분, 소득세법 제52조제1항)와 그 밖의 소득공제(입력) →
 * 과세표준 → 기본세율 → 근로소득세액공제(한도) → 그 밖의 세액공제(입력) 또는 표준세액공제 → 결정세액. 지방소득세는 결정세액의
 * 10%(10원 미만 절사)입니다.
 *
 * 특별세액공제를 신청하지 않으면 표준세액공제(연 13만원)를 받습니다(소득세법 제59조의4제9항, 원문 미대조). 표준세액공제는 보험료
 * 소득공제를 대신하지 않으므로 과세표준은 두 방법이 같고, 그 밖의 세액공제 합계와 13만원 중 결정세액이 적은 쪽을 고릅니다(같으면
 * 특별세액공제). 주택자금 특별소득공제는 표준세액공제와 함께 받을 수 없지만 따로 모델링하지 않습니다. 차감징수세액은 결정세액 − 기납부세액이고 10원 미만은 0 쪽으로 버립니다. 음수면 환급입니다.
 *
 * 자녀세액공제(소득세법 제59조의2)·연금계좌·의료비 등은 따로 계산하지 않고 그 밖의 세액공제 입력으로 받습니다.
 */
export function calculateWageSettlement(
  totals: WageYearTotals,
  dependants: number,
  input: WageSettlementInput,
  rates: PayrollRateTable,
): WageSettlementResult {
  const 근로소득세기준 = rates.wageIncomeTax
  const 총급여 = totals.taxablePay
  const 근로소득공제 = earnedIncomeDeductionOf(총급여, rates)
  const 근로소득금액 = Math.max(0, 총급여 - 근로소득공제)
  const 인적공제 = 근로소득세기준.personalDeductionPerDependant * Math.max(1, dependants)
  const 연금보험료공제 = totals.nationalPension
  const 보험료공제 = totals.healthInsurance + totals.employmentInsurance
  const 그밖의소득공제 = input.otherIncomeDeductions ?? 0
  const 그밖의세액공제 = input.otherTaxCredits ?? 0

  const 과세표준 = Math.max(0, 근로소득금액 - 인적공제 - 연금보험료공제 - 보험료공제 - 그밖의소득공제)
  const 산출세액 = progressiveTax(과세표준, rates)
  const 근로소득세액공제 = earnedIncomeCreditOf(산출세액, 총급여, rates)
  const 결정 = (특별세액공제: boolean) => {
    const 표준세액공제 = 특별세액공제 ? 0 : 근로소득세기준.standardTaxCredit
    const 결정세액 = Math.max(0, 산출세액 - 근로소득세액공제 - 표준세액공제 - (특별세액공제 ? 그밖의세액공제 : 0))
    return { 과세표준, 산출세액, 근로소득세액공제, 표준세액공제, 결정세액 }
  }
  const 특별 = 결정(true)
  const 표준 = 결정(false)
  const 고른 = 표준.결정세액 < 특별.결정세액 ? 표준 : 특별
  const 특별공제인가 = 고른 === 특별
  const 결정지방소득세 = localIncomeTaxOf(고른.결정세액, rates)
  return {
    totalPay: 총급여,
    earnedIncomeDeduction: 근로소득공제,
    earnedIncome: 근로소득금액,
    personalDeduction: 인적공제,
    pensionDeduction: 연금보험료공제,
    insuranceDeduction: 보험료공제,
    otherIncomeDeductions: 그밖의소득공제,
    taxBase: 고른.과세표준,
    calculatedTax: 고른.산출세액,
    earnedIncomeCredit: 고른.근로소득세액공제,
    standardTaxCredit: 고른.표준세액공제,
    otherTaxCredits: 특별공제인가 ? Math.min(그밖의세액공제, Math.max(0, 산출세액 - 근로소득세액공제)) : 0,
    deductionMethod: 특별공제인가 ? 'ITEMIZED' : 'STANDARD',
    determinedTax: 고른.결정세액,
    determinedLocalIncomeTax: 결정지방소득세,
    withheldIncomeTax: totals.withheldIncomeTax,
    withheldLocalIncomeTax: totals.withheldLocalIncomeTax,
    balanceIncomeTax: 영쪽절사(고른.결정세액 - totals.withheldIncomeTax, 근로소득세기준.taxRoundingUnit),
    balanceLocalIncomeTax: 영쪽절사(결정지방소득세 - totals.withheldLocalIncomeTax, rates.localIncomeTax.roundingUnit),
  }
}

/** 정산이 원천세에 들어가는 지급월입니다. 확정했고 지급일이 있으면 그 달, 아니면 `null`입니다. */
export function wageSettlementMonthOf(
  settlement: Pick<WageTaxSettlementRecord, 'status' | 'paymentDate'>,
): string | null {
  return settlement.status === 'COMPLETED' && settlement.paymentDate !== undefined
    ? settlement.paymentDate.slice(0, 7)
    : null
}

/**
 * 지급월에 확정한 근로소득 정산의 원천세 줄입니다. 중도퇴사(`WAGE_MID_YEAR_SETTLEMENT`, A02)와 연말정산(`WAGE_ANNUAL_SETTLEMENT`, A04)을
 * 따로 모으고, 정산이 없는 종류는 빠집니다.
 *
 * 인원은 직원 수, 총지급액은 그해 총지급액, 과세 지급액은 총급여, 세액은 차감징수세액(환급이면 음수)입니다.
 */
export function wageSettlementWithholdingPaidIn(
  settlements: readonly WageTaxSettlementRecord[],
  paymentMonth: string,
): WithholdingSummaryLine[] {
  const 종류별 = [
    ['MID_YEAR', 'WAGE_MID_YEAR_SETTLEMENT'],
    ['ANNUAL', 'WAGE_ANNUAL_SETTLEMENT'],
  ] as const
  return 종류별.flatMap(([kind, incomeKind]) => {
    const 정산들 = settlements.filter(
      (settlement) => settlement.kind === kind && wageSettlementMonthOf(settlement) === paymentMonth,
    )
    if (정산들.length === 0) return []
    const 합 = (pick: (settlement: WageTaxSettlementRecord) => number) =>
      정산들.reduce((total, settlement) => total + pick(settlement), 0)
    return [
      {
        incomeKind,
        otherIncomeCategory: null,
        headcount: new Set(정산들.map((settlement) => settlement.employeeId)).size,
        grossPay: 합((settlement) => settlement.totals.grossPay),
        taxablePay: 합((settlement) => settlement.result.totalPay),
        incomeTax: 합((settlement) => settlement.result.balanceIncomeTax),
        localIncomeTax: 합((settlement) => settlement.result.balanceLocalIncomeTax),
      },
    ]
  })
}

/** 정산 하나가 바뀌기 전후로 원천세 합계가 바뀐 지급월입니다. 확정·다시 열기·확정한 채 금액이 바뀐 달입니다. */
export function wageSettlementMonthsChanged(
  before: WageTaxSettlementRecord | undefined,
  after: WageTaxSettlementRecord | undefined,
): string[] {
  const 이전 = before === undefined ? null : wageSettlementMonthOf(before)
  const 이후 = after === undefined ? null : wageSettlementMonthOf(after)
  if (이전 === 이후) return []
  return [이전, 이후].filter((month) => month !== null).toSorted()
}

/**
 * 정산 하나의 변경이 건드리는 지급월입니다. 원천세 신고 잠금이 이 달들을 봅니다. 합계가 바뀐 달에 더해, 지급일을 새로 정하거나
 * 옮기면 옮겨 갈 달이 듭니다(퇴직금 정산의 `severanceMonthsTouched`와 같은 규칙).
 */
export function wageSettlementMonthsTouched(
  before: WageTaxSettlementRecord | undefined,
  after: WageTaxSettlementRecord | undefined,
): string[] {
  const 이전지급일월 = before?.paymentDate?.slice(0, 7)
  const 이후지급일월 = after?.paymentDate?.slice(0, 7)
  const 들이는달 = 이후지급일월 === undefined || 이후지급일월 === 이전지급일월 ? [] : [이후지급일월]
  return [...new Set([...wageSettlementMonthsChanged(before, after), ...들이는달])].toSorted()
}

/** 0 쪽으로 `unit`원 미만을 버립니다. 환급(음수)도 절댓값의 끝수를 버립니다. */
function 영쪽절사(amount: number, unit: RoundingUnit): number {
  const 끝수버린값 = truncateTo(Math.abs(amount), unit)
  return 끝수버린값 === 0 ? 0 : Math.sign(amount) * 끝수버린값
}
