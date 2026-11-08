import type { WithholdingSummaryLine } from '../ledgers/pay-month.types.ts'
import type { SeveranceSettlementRecord } from './severance-settlement.types.ts'

/**
 * 정산이 원천세 퇴직소득에 들어가는 지급월(`YYYY-MM`)입니다. 들어가지 않으면 `null`입니다.
 *
 * 완료(`COMPLETED`)했고 지급일이 있고 지급한 퇴직금이 있는 정산만 들어갑니다. 계산됨·제외는 아직 지급하지 않은 것이고,
 * 근속 1년 미만처럼 퇴직금이 0원인 정산은 지급한 퇴직소득이 없습니다. 지급일은 완료할 때 채워지므로 완료한 정산은
 * 이 필드가 생기기 전에 저장한 것만 지급일이 없습니다.
 */
export function severanceWithholdingMonthOf(settlement: SeveranceSettlementRecord): string | null {
  if (settlement.status !== 'COMPLETED' || settlement.paymentDate === undefined) return null
  if (settlement.result.severancePay <= 0) return null
  return settlement.paymentDate.slice(0, 7)
}

/**
 * 지급월에 지급한 퇴직소득의 원천세 합계입니다. 넣을 정산이 없으면 `null`입니다.
 *
 * 인원은 직원 ID로 중복 없이 셉니다. 퇴직금에는 비과세를 두지 않아 총지급액과 과세 지급액이 모두 퇴직금입니다.
 * 세액은 퇴직소득세와 그 지방소득세입니다. Tax가 이 줄을 원천징수이행상황신고서의 퇴직소득 그 외(A22)에 적습니다.
 */
export function severanceWithholdingPaidIn(
  settlements: readonly SeveranceSettlementRecord[],
  paymentMonth: string,
): WithholdingSummaryLine | null {
  const 지급월정산 = settlements.filter((settlement) => severanceWithholdingMonthOf(settlement) === paymentMonth)
  if (지급월정산.length === 0) return null
  const 퇴직금합계 = sum(지급월정산.map((settlement) => settlement.result.severancePay))
  return {
    incomeKind: 'RETIREMENT',
    otherIncomeCategory: null,
    headcount: new Set(지급월정산.map((settlement) => settlement.employeeId)).size,
    grossPay: 퇴직금합계,
    taxablePay: 퇴직금합계,
    incomeTax: sum(지급월정산.map((settlement) => settlement.result.retirementIncomeTax)),
    localIncomeTax: sum(지급월정산.map((settlement) => settlement.result.localIncomeTax)),
  }
}

/**
 * 정산 하나가 바뀌기 전후를 비교해 원천세 퇴직소득 합계가 바뀐 지급월을 앞에서부터 돌려줍니다.
 *
 * 완료는 새 지급월, 다시 열기는 원래 지급월, 완료한 채 지급일을 옮기면 두 달 모두입니다. 계산됨·제외 정산의 입력·지급일
 * 변경은 합계에 들지 않아 빈 목록입니다. 완료한 정산의 금액은 다시 열어야 바뀌므로 같은 달 안의 금액 변화는 따로 보지 않습니다.
 * `before`가 없으면 새로 만든 정산입니다.
 */
export function severanceWithholdingMonthsChanged(
  before: SeveranceSettlementRecord | undefined,
  after: SeveranceSettlementRecord,
): string[] {
  const 이전지급월 = before === undefined ? null : severanceWithholdingMonthOf(before)
  const 이후지급월 = severanceWithholdingMonthOf(after)
  if (이전지급월 === 이후지급월) return []
  return [이전지급월, 이후지급월].filter((month) => month !== null).toSorted()
}

/**
 * 정산 하나의 변경이 건드리는 지급월입니다. 원천세 신고 잠금(`WithholdingFilingLock`)은 이 달들을 봅니다.
 *
 * 퇴직소득 합계가 바뀐 달({@link severanceWithholdingMonthsChanged})에 더해, 지급일의 달이 바뀌면 옮기기 전후 두 달이 듭니다
 * (지급일을 새로 정하면 그 달, 지우면 원래 달). 계산됨 정산은 합계에 들지 않지만, 급여대장의 생성·지급일 이동처럼 신고된 달로
 * 들이거나 신고된 달에서 빼내는 것을 함께 막습니다. 그래서 신고된 달에는 나중에 완료할 정산이 새로 생기지 않습니다.
 */
export function severanceMonthsTouched(
  before: SeveranceSettlementRecord | undefined,
  after: SeveranceSettlementRecord,
): string[] {
  const 이전지급일월 = before?.paymentDate?.slice(0, 7)
  const 이후지급일월 = after.paymentDate?.slice(0, 7)
  const 지급일이동 = 이전지급일월 === 이후지급일월 ? [] : [이전지급일월, 이후지급일월]
  const 지급월목록 = [...severanceWithholdingMonthsChanged(before, after), ...지급일이동]
  return [...new Set(지급월목록.filter((month) => month !== undefined))].toSorted()
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
