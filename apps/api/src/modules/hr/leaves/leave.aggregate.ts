import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { EmployeeRecord } from '../employees/employee.ts'
import type { InsuranceFilingPayloads } from '../insurance-filings/insurance-filing.types.ts'
import { validateLeave } from './leave-rules.ts'
import type { LeaveTerms, LeaveValidation } from './leave-rules.types.ts'
import { LeaveInvalid, LeaveOverlap, type CreateLeave, type LeaveRecord } from './leave.ts'

/**
 * 휴직 애그리거트입니다(docs/design/domain-model.md). 등록·복직·삭제의 판정 함수를 둡니다.
 *
 * 판정은 순수 함수입니다. 직원(입사일·퇴직일·소득 구분)과 같은 직원의 다른 휴직은 서비스가 읽어 넘깁니다. 같은 직원의 휴직
 * 기간이 겹치지 않는다는 규칙은 미리 읽은 다른 휴직으로 지킵니다(M3).
 *
 * 4대보험 휴직·복직 신고를 열고 거두는 일은 domain-model.md 4단계(M6 정책)까지 서비스가 합니다. 판정은 무엇을 열고 거둘지
 * (`filings`)만 알려 주고, 서비스는 그 순서대로 합니다. 근로소득자(`WAGE`)만 신고 대상입니다. 휴직은 이벤트를 내지 않습니다.
 */

/** 판정이 알려 주는 4대보험 신고 변경입니다. 같은 휴직을 원인으로 하는 신고입니다. */
export type LeaveFilingChange =
  | { action: 'WITHDRAW'; kind: 'LEAVE' | 'RETURN' }
  | { action: 'OPEN'; kind: 'LEAVE'; payload: InsuranceFilingPayloads['LEAVE'] }
  | { action: 'OPEN'; kind: 'RETURN'; payload: InsuranceFilingPayloads['RETURN'] }

/** 판정 결과입니다. */
export interface LeaveDecision {
  leave: LeaveRecord
  filings: LeaveFilingChange[]
}

/** 판정에 넘기는 사실입니다. 직원이 지워졌으면 `employee`가 없습니다. */
export interface LeaveFacts {
  employee: Pick<EmployeeRecord, 'joinDate' | 'resignation' | 'kind'> | undefined
  /** 같은 직원의 다른 휴직입니다. 판정할 휴직 자신은 뺍니다. */
  otherLeaves: ReadonlyArray<LeaveRecord>
}

/** 만들 휴직입니다. ID는 서비스가 정합니다. */
export interface LeaveCreation {
  id: Id<'leave'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  terms: typeof CreateLeave.Type
}

function checked(
  terms: LeaveTerms,
  facts: LeaveFacts,
): Result.Result<LeaveValidation['normalized'], LeaveInvalid | LeaveOverlap> {
  const result = validateLeave(terms, {
    joinDate: facts.employee?.joinDate,
    leaveDate: facts.employee?.resignation?.leaveDate,
    otherLeaves: facts.otherLeaves,
  })
  if (result.violations.length > 0) return Result.fail(new LeaveInvalid({ violations: result.violations }))
  if (result.overlappingLeaveId !== undefined) {
    return Result.fail(new LeaveOverlap({ overlappingLeaveId: result.overlappingLeaveId as Id<'leave'> }))
  }
  return Result.succeed(result.normalized)
}

/**
 * 휴직 등록을 판정합니다. 입사일 전·퇴직일 뒤이거나 입력이 틀리면 `LeaveInvalid`, 다른 휴직과 겹치면 `LeaveOverlap`입니다. 복직
 * 예정일과 육아휴직 근속 포함은 규칙이 채웁니다. 근로소득자면 휴직 신고를 엽니다.
 */
export function decideLeaveCreation(
  input: LeaveCreation,
  facts: LeaveFacts,
): Result.Result<LeaveDecision, LeaveInvalid | LeaveOverlap> {
  const { terms } = input
  return Result.map(checked(terms, facts), (normalized) => {
    const leave: LeaveRecord = {
      id: input.id,
      companyId: input.companyId,
      employeeId: input.employeeId,
      reason: terms.reason,
      startDate: terms.startDate,
      endDate: terms.endDate,
      expectedReturnDate: normalized.expectedReturnDate,
      paidAllowance: terms.paid?.allowance,
      includeInServiceYears: normalized.includeInServiceYears,
      npsPaymentException: terms.npsPaymentException ?? false,
      nhisNoticeDeferral: terms.nhisNoticeDeferral ?? false,
      version: 1,
    }
    const filings: LeaveFilingChange[] =
      facts.employee?.kind === 'WAGE'
        ? [
            {
              action: 'OPEN',
              kind: 'LEAVE',
              payload: {
                startDate: leave.startDate,
                endDate: leave.endDate,
                npsPaymentException: leave.npsPaymentException,
                nhisNoticeDeferral: leave.nhisNoticeDeferral,
              },
            },
          ]
        : []
    return { leave, filings }
  })
}

/**
 * 복직을 판정합니다. 복직일이 규칙에 맞지 않으면 `LeaveInvalid`입니다. 기간은 그대로라 겹침(`LeaveOverlap`)은 생기지 않지만 같은
 * 규칙을 쓰므로 결과 타입에 남고, 서비스는 결함으로 봅니다. 근로소득자면 이전 복직 신고를 거두고 새로 엽니다(복직일을 고쳐 다시
 * 부를 때).
 */
export function decideLeaveReturn(
  leave: LeaveRecord,
  actualReturnDate: string,
  facts: LeaveFacts,
): Result.Result<LeaveDecision, LeaveInvalid | LeaveOverlap> {
  const terms: LeaveTerms = {
    ...leave,
    actualReturnDate,
    ...(leave.paidAllowance === undefined ? {} : { paid: { allowance: leave.paidAllowance } }),
  }
  return Result.map(checked(terms, facts), () => ({
    leave: { ...leave, actualReturnDate, version: leave.version + 1 },
    filings:
      facts.employee?.kind === 'WAGE'
        ? [
            { action: 'WITHDRAW', kind: 'RETURN' },
            {
              action: 'OPEN',
              kind: 'RETURN',
              payload: { leaveStartDate: leave.startDate, returnDate: actualReturnDate },
            },
          ]
        : [],
  }))
}

/**
 * 휴직 삭제를 판정합니다. 막는 규칙은 없습니다. 휴직 신고와 복직 신고를 함께 거둬 없는 휴직의 신고가 남지 않게 합니다(현행
 * `removeLeave`와 같음). 소득 구분과 관계없이 거둡니다.
 */
export function decideLeaveRemoval(): { filings: LeaveFilingChange[] } {
  return {
    filings: [
      { action: 'WITHDRAW', kind: 'LEAVE' },
      { action: 'WITHDRAW', kind: 'RETURN' },
    ],
  }
}
