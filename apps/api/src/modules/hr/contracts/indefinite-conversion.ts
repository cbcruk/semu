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
  const 기간제계약 = contracts
    .flatMap((contract) =>
      contract.contractType === 'FIXED_TERM' && contract.endDate !== undefined
        ? [{ start: contract.startDate, end: contract.endDate, exemption: contract.termLimitExemption }]
        : [],
    )
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const 최종계약 = 기간제계약.at(-1)
  if (최종계약 === undefined) return { isTarget: false, status: 'NONE', isExempt: false, totalContractDays: 0 }
  let 사슬시작일 = 최종계약.start
  let 사슬종료일 = 최종계약.end
  let firstIndex = 기간제계약.length - 1
  for (let index = 기간제계약.length - 2; index >= 0; index -= 1) {
    const 앞계약 = 기간제계약[index]
    if (앞계약 === undefined || addDays(앞계약.end, 1) < 사슬시작일) break
    if (앞계약.start < 사슬시작일) 사슬시작일 = 앞계약.start
    if (앞계약.end > 사슬종료일) 사슬종료일 = 앞계약.end
    firstIndex = index
  }
  const 사슬 = 기간제계약.slice(firstIndex)
  const 전환일 = addMonthsToDate(사슬시작일, 24)
  const 예외없는계약으로전환임 = 사슬.some((contract) => contract.exemption === undefined && contract.end >= 전환일)
  const 예외사유 =
    birthDate !== undefined && ageOn(birthDate, 사슬시작일) >= INDEFINITE_CONVERSION_EXEMPT_AGE
      ? ('AGED_55_OR_OVER' as const)
      : 예외없는계약으로전환임
        ? undefined
        : 최종계약.exemption
  const 예외임 = 예외사유 !== undefined
  const 전환일까지일수 = daysBetween(asOf, 전환일)
  const status =
    사슬종료일 >= 전환일
      ? 'EXCEEDED'
      : 사슬종료일 >= asOf && 전환일까지일수 <= INDEFINITE_CONVERSION_NOTICE_DAYS
        ? 'APPROACHING'
        : 'NONE'
  return {
    isTarget: !예외임 && status !== 'NONE',
    status,
    isExempt: 예외임,
    ...(예외사유 === undefined ? {} : { exemptReason: 예외사유 }),
    chainStartDate: 사슬시작일,
    chainEndDate: 사슬종료일,
    totalContractDays: daysBetween(사슬시작일, 사슬종료일) + 1,
    conversionDate: 전환일,
    daysUntilConversion: 전환일까지일수,
  }
}
