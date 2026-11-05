import { addDays, ageOn, daysBetween } from '../../../shared/time/calendar.ts'
import { addMonthsToDate } from '../shared/hr-dates.ts'
import type { ContractPeriod } from './work-contract-period.types.ts'
import type { IndefiniteConversion } from './indefinite-conversion.types.ts'

/** 2년 도달 몇 일 전부터 `APPROACHING`으로 알리는지입니다. 제품 값은 미확인입니다. */
export const INDEFINITE_CONVERSION_NOTICE_DAYS = 90

/** 무기계약 전환 예외 나이입니다(기간제법 제4조 ① 4호의 고령자, 고령자고용법 시행령 제2조 ①: 만 55세 이상). */
export const INDEFINITE_CONVERSION_EXEMPT_AGE = 55

/**
 * 연속된 기간제 계약이 2년에 닿는지 판정합니다(기간제법 제4조).
 *
 * 다음 계약이 앞 계약 종료일 다음날까지 시작하면 이어진 것으로 보고, 가장 늦은 기간제 계약이 속한 사슬만 봅니다.
 * 사슬 시작일 + 24개월이 전환일입니다. 사슬이 전환일에 닿으면 `EXCEEDED`, 아직 끝나지 않았고 전환일이
 * {@link INDEFINITE_CONVERSION_NOTICE_DAYS}일 안이면 `APPROACHING`입니다. 사슬 시작일에 만 55세 이상이면 예외입니다.
 *
 * 사용기간 제한 예외 사유(`termLimitExemption`)는 사슬 전체로 봅니다. 예외 사유가 없는 계약이 전환일 이후까지 이어지면
 * 그날 기간의 정함이 없는 근로계약으로 보므로(제4조 ②) 뒤의 예외 계약과 상관없이 전환이 섭니다. 그런 계약이 없고
 * 가장 늦은 계약에 예외 사유가 있을 때만 그 사유로 예외입니다.
 */
export function indefiniteConversion(
  contracts: ReadonlyArray<ContractPeriod>,
  birthDate: string | undefined,
  asOf: string,
): IndefiniteConversion {
  const fixedTerm = contracts
    .flatMap((contract) =>
      contract.contractType === 'FIXED_TERM' && contract.endDate !== undefined
        ? [{ start: contract.startDate, end: contract.endDate, exemption: contract.termLimitExemption }]
        : [],
    )
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const last = fixedTerm.at(-1)
  if (last === undefined) return { isTarget: false, status: 'NONE', isExempt: false, totalContractDays: 0 }
  let chainStart = last.start
  let chainEnd = last.end
  let firstIndex = fixedTerm.length - 1
  for (let index = fixedTerm.length - 2; index >= 0; index -= 1) {
    const previous = fixedTerm[index]
    if (previous === undefined || addDays(previous.end, 1) < chainStart) break
    if (previous.start < chainStart) chainStart = previous.start
    if (previous.end > chainEnd) chainEnd = previous.end
    firstIndex = index
  }
  const chain = fixedTerm.slice(firstIndex)
  const conversionDate = addMonthsToDate(chainStart, 24)
  const convertedWithoutExemption = chain.some(
    (contract) => contract.exemption === undefined && contract.end >= conversionDate,
  )
  const exemptReason =
    birthDate !== undefined && ageOn(birthDate, chainStart) >= INDEFINITE_CONVERSION_EXEMPT_AGE
      ? ('AGED_55_OR_OVER' as const)
      : convertedWithoutExemption
        ? undefined
        : last.exemption
  const isExempt = exemptReason !== undefined
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
    ...(exemptReason === undefined ? {} : { exemptReason }),
    chainStartDate: chainStart,
    chainEndDate: chainEnd,
    totalContractDays: daysBetween(chainStart, chainEnd) + 1,
    conversionDate,
    daysUntilConversion,
  }
}
