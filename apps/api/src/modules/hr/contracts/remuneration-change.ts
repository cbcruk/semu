import type { InsuranceFilingPayloads } from '../insurance-filings/insurance-filing.types.ts'

/** 보수 변경을 판단하는 급여계약의 값입니다. */
export interface RemunerationTerms {
  id: string
  startDate: string
  wageType: 'MONTHLY' | 'DAILY' | 'HOURLY'
  amount: number
}

/** 보수 변경 신고가 있어야 하는 계약과 그 내용입니다. */
export interface RemunerationChange {
  contractId: string
  payload: InsuranceFilingPayloads['REMUNERATION_CHANGE']
}

/**
 * 직원의 급여계약 전체에서 보수 변경 신고가 있어야 하는 계약입니다. 시작일 순으로 늘어놓고, 가장 이른 계약은 빼고(그 보수는
 * 취득 신고가 다룹니다), 바로 앞 계약과 지급 단위나 금액이 다른 계약만 고릅니다. 그중 그날 4대보험(국민연금·건강·고용)에 하나도
 * 가입하지 않은 계약(`enrolledOn`이 거짓)은 뺍니다.
 *
 * 계약 금액과 지급 단위만 봅니다. 시급제의 월 소정근로시간이나 고정수당만 바뀐 경우는 잡지 않습니다.
 *
 * @example
 * ```ts
 * remunerationChanges([{ id: 'a', startDate: '2026-01-02', wageType: 'MONTHLY', amount: 3_000_000 },
 *   { id: 'b', startDate: '2026-07-01', wageType: 'MONTHLY', amount: 3_300_000 }], () => true)
 * // [{ contractId: 'b', payload: { effectiveFrom: '2026-07-01', wageType: 'MONTHLY', amount: 3_300_000 } }]
 * ```
 */
export function remunerationChanges(
  contracts: ReadonlyArray<RemunerationTerms>,
  enrolledOn: (date: string) => boolean,
): RemunerationChange[] {
  const 시작일순 = contracts.toSorted((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
  const changes: RemunerationChange[] = []
  for (let index = 1; index < 시작일순.length; index++) {
    const 직전 = 시작일순[index - 1]!
    const 이번 = 시작일순[index]!
    if (직전.wageType === 이번.wageType && 직전.amount === 이번.amount) continue
    if (!enrolledOn(이번.startDate)) continue
    changes.push({
      contractId: 이번.id,
      payload: { effectiveFrom: 이번.startDate, wageType: 이번.wageType, amount: 이번.amount },
    })
  }
  return changes
}
