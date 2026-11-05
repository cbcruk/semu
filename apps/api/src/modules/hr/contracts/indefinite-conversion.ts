import { addDays, ageOn, daysBetween } from '../../../shared/time/calendar.ts'
import { addMonthsToDate } from '../shared/hr-dates.ts'
import type { ContractPeriod } from './work-contract-period.types.ts'
import type { IndefiniteConversion } from './indefinite-conversion.types.ts'

/** 2년 도달 몇 일 전부터 `APPROACHING`으로 알리는지입니다. 제품 값은 미확인입니다. */
export const INDEFINITE_CONVERSION_NOTICE_DAYS = 90

/** 무기계약 전환 예외 나이입니다(기간제법 시행령, 만 55세 이상). */
export const INDEFINITE_CONVERSION_EXEMPT_AGE = 55

/**
 * 연속된 기간제 계약이 2년에 닿는지 판정합니다(기간제법 제4조).
 *
 * 다음 계약이 앞 계약 종료일 다음날까지 시작하면 이어진 것으로 보고, 가장 늦은 기간제 계약이 속한 사슬만 봅니다.
 * 사슬 시작일 + 24개월이 전환일입니다. 사슬이 전환일에 닿으면 `EXCEEDED`, 아직 끝나지 않았고 전환일이
 * {@link INDEFINITE_CONVERSION_NOTICE_DAYS}일 안이면 `APPROACHING`입니다. 사슬 시작일에 만 55세 이상이면 예외입니다.
 */
export function indefiniteConversion(
  contracts: ReadonlyArray<ContractPeriod>,
  birthDate: string | undefined,
  asOf: string,
): IndefiniteConversion {
  const fixedTerm = contracts
    .flatMap((contract) =>
      contract.contractType === 'FIXED_TERM' && contract.endDate !== undefined
        ? [{ start: contract.startDate, end: contract.endDate }]
        : [],
    )
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const last = fixedTerm.at(-1)
  if (last === undefined) return { isTarget: false, status: 'NONE', isExempt: false, totalContractDays: 0 }
  let chainStart = last.start
  let chainEnd = last.end
  for (let index = fixedTerm.length - 2; index >= 0; index -= 1) {
    const previous = fixedTerm[index]
    if (previous === undefined || addDays(previous.end, 1) < chainStart) break
    if (previous.start < chainStart) chainStart = previous.start
    if (previous.end > chainEnd) chainEnd = previous.end
  }
  const conversionDate = addMonthsToDate(chainStart, 24)
  const isExempt = birthDate !== undefined && ageOn(birthDate, chainStart) >= INDEFINITE_CONVERSION_EXEMPT_AGE
  const daysUntilConversion = daysBetween(asOf, conversionDate)
  const status =
    chainEnd >= conversionDate
      ? 'EXCEEDED'
      : chainEnd >= asOf && daysUntilConversion <= INDEFINITE_CONVERSION_NOTICE_DAYS
        ? 'APPROACHING'
        : 'NONE'
  return {
    isTarget: !isExempt && status !== 'NONE',
    status,
    isExempt,
    ...(isExempt ? { exemptReason: 'AGED_55_OR_OVER' as const } : {}),
    chainStartDate: chainStart,
    chainEndDate: chainEnd,
    totalContractDays: daysBetween(chainStart, chainEnd) + 1,
    conversionDate,
    daysUntilConversion,
  }
}
