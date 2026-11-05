import type { ContractPeriod, WorkContractStatus } from './work-contract-period.types.ts'

/** 근로계약의 `asOf` 상태입니다. 시작 전이면 `SCHEDULED`, 종료일이 지났으면 `EXPIRED`입니다. */
export function workContractStatus(
  contract: Pick<ContractPeriod, 'startDate' | 'endDate'>,
  asOf: string,
): WorkContractStatus {
  if (contract.startDate > asOf) return 'SCHEDULED'
  if (contract.endDate !== undefined && contract.endDate < asOf) return 'EXPIRED'
  return 'ACTIVE'
}

/**
 * 직원의 "현재" 근로계약입니다. 목록 경고와 레거시 응답이 씁니다.
 *
 * 시작일이 `asOf` 이전인 계약 중 가장 늦게 시작한 것, 없으면 가장 먼저 시작할 예정 계약입니다.
 * 시작일이 같으면 나중에 들어온 계약(배열 뒤쪽)을 씁니다.
 */
export function currentWorkContract<C extends ContractPeriod>(
  contracts: ReadonlyArray<C>,
  asOf: string,
): C | undefined {
  let started: C | undefined
  let upcoming: C | undefined
  for (const contract of contracts) {
    if (contract.startDate <= asOf) {
      if (started === undefined || contract.startDate >= started.startDate) started = contract
    } else if (upcoming === undefined || contract.startDate < upcoming.startDate) {
      upcoming = contract
    }
  }
  return started ?? upcoming
}

/** `contract` 종료일 뒤에 시작하는 계약이 있는지입니다. 만료 경고를 끄는 조건입니다. */
export function isFollowedByLaterContract(contract: ContractPeriod, contracts: ReadonlyArray<ContractPeriod>): boolean {
  const end = contract.endDate
  return end !== undefined && contracts.some((other) => other.startDate > end)
}

/** `asOf`에 유효한 계약입니다. 시작일 ≤ asOf ≤ 종료일(없으면 무기한)이고, 여럿이면 가장 늦게 시작한 것입니다. */
export function contractInForce<C extends Pick<ContractPeriod, 'startDate' | 'endDate'>>(
  contracts: ReadonlyArray<C>,
  asOf: string,
): C | undefined {
  return contracts
    .filter((contract) => contract.startDate <= asOf && (contract.endDate === undefined || contract.endDate >= asOf))
    .reduce<C | undefined>(
      (latest, contract) => (latest === undefined || contract.startDate >= latest.startDate ? contract : latest),
      undefined,
    )
}
