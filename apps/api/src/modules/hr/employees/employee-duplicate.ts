import type { EmployeeStatus } from './employee-status.types.ts'

/** 같은 회사·같은 종류에서 주민등록번호 해시가 같은 직원입니다. */
export interface DuplicateCandidate {
  id: string
  status: EmployeeStatus
}

/**
 * 등록·수정을 막는 중복 직원을 찾습니다.
 *
 * 자기 자신은 빼고, 재입사(`isRejoin`)이면 퇴직한 직원은 막지 않습니다. 재입사라도 퇴직하지 않은
 * 직원이 있으면 그 직원이 막습니다. 막는 직원이 없으면 `undefined`입니다.
 *
 * @example 퇴직자의 재입사
 * ```ts
 * findBlockingDuplicate([{ id: 'emp_1', status: 'RESIGNED' }], { isRejoin: true }) // undefined
 * findBlockingDuplicate([{ id: 'emp_1', status: 'RESIGNED' }], { isRejoin: false }) // 'emp_1'
 * ```
 */
export function findBlockingDuplicate(
  candidates: ReadonlyArray<DuplicateCandidate>,
  options: { selfId?: string | undefined; isRejoin: boolean },
): string | undefined {
  return candidates.find(
    (candidate) => candidate.id !== options.selfId && (candidate.status !== 'RESIGNED' || !options.isRejoin),
  )?.id
}
