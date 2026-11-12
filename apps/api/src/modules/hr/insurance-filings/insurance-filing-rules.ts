import { addDays } from '../../../shared/time/calendar.ts'
import type { InsuranceFiling, InsuranceFilingCommand, InsuranceFilingStatus } from './insurance-filing.types.ts'

/** 원인이 취소되면 닫는 상태입니다. 실패한 신고도 다시 처리할 일이 남아 있으므로 열린 신고로 봅니다. */
export const OPEN_STATUSES: ReadonlyArray<InsuranceFilingStatus> = ['PENDING', 'FAILED']

/**
 * 처리 커맨드를 적용한 신고입니다. 열린 신고만 처리할 수 있고, 닫힌 신고(`DONE`·`WITHDRAWN`)는 `undefined`입니다.
 *
 * - 완료: `PENDING`·`FAILED` → `DONE`. 실패 사유는 지웁니다
 * - 실패: `PENDING` → `FAILED`. 이미 실패한 신고를 다시 실패로 두면 사유만 바꿉니다
 *
 * @example
 * ```ts
 * applyInsuranceFilingCommand(pending, { type: 'FAIL', message: '주민번호 불일치' }, at)?.status // 'FAILED'
 * applyInsuranceFilingCommand(done, { type: 'COMPLETE' }, at) // undefined
 * ```
 */
export function applyInsuranceFilingCommand(
  filing: InsuranceFiling,
  command: InsuranceFilingCommand,
  at: string,
): InsuranceFiling | undefined {
  if (!OPEN_STATUSES.includes(filing.status)) return undefined
  const { resultMessage: _, ...rest } = filing
  if (command.type === 'COMPLETE') return { ...rest, status: 'DONE', processedAt: at }
  return { ...rest, status: 'FAILED', processedAt: at, resultMessage: command.message }
}

/**
 * 4대보험 자격 상실일입니다. 퇴직일(마지막 근무일)의 다음 날입니다(국민연금법 제12조, 국민건강보험법 제10조,
 * 고용보험법 제14조).
 */
export function lossDateOf(leaveDate: string): string {
  return addDays(leaveDate, 1)
}
