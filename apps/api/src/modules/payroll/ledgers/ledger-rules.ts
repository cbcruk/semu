import { addDays, addMonths, lastDayOfMonth } from '../../../shared/time/calendar.ts'
import type { LedgerStatus } from './ledger-status.types.ts'

/** 귀속월 기준 지급일이 있는 달입니다. 현행 `payment_month`(`previous`·`current`·`next`)입니다. */
export type PaymentMonthRule = 'PREVIOUS' | 'SAME' | 'NEXT'

/** 추가 급여대장 생성을 막는 규칙입니다. 앞에서부터 처음 걸린 것 하나만 돌려줍니다. */
export type AdditionalLedgerBlocker =
  | 'NO_REGULAR_LEDGER'
  | 'REGULAR_LEDGER_NOT_SUBMITTED'
  | 'DRAFT_LEDGER_EXISTS'
  | 'WITHHOLDING_FILED'
  | 'WITHHOLDING_DEADLINE_NEAR'

/** 원천세 신고 기한 며칠 전부터 추가 대장을 막는지입니다. 매뉴얼 "마감일 5일 전"입니다. */
export const ADDITIONAL_LEDGER_DEADLINE_MARGIN_DAYS = 5

/**
 * 귀속월의 기본 지급일입니다. 급여 설정의 지급월 규칙과 지급일을 쓰고, 그달에 없는 날(31일 등)은 말일로 당깁니다.
 *
 * @example 매월 25일, 다음 달 지급
 * ```ts
 * defaultPaymentDate('2026-10', { paymentMonth: 'NEXT', paymentDay: 25 }) // '2026-11-25'
 * ```
 */
export function defaultPaymentDate(
  attributionMonth: string,
  terms: { paymentMonth: PaymentMonthRule; paymentDay: number },
): string {
  const offset = terms.paymentMonth === 'NEXT' ? 1 : terms.paymentMonth === 'PREVIOUS' ? -1 : 0
  return dayInMonth(addMonths(attributionMonth, offset), terms.paymentDay)
}

/**
 * 귀속월의 임금산정 기간입니다. 그달 `startDay`일부터 한 달입니다. 시작일이 1이면 그달 1일~말일입니다.
 */
export function wagePeriodOf(attributionMonth: string, startDay: number): { start: string; end: string } {
  const start = dayInMonth(attributionMonth, startDay)
  const nextStart = dayInMonth(addMonths(attributionMonth, 1), startDay)
  return { start, end: addDays(nextStart, -1) }
}

/** 지급일의 지급월(`YYYY-MM`)입니다. 원천세는 지급월 기준입니다. */
export function paymentMonthOf(paymentDate: string): string {
  return paymentDate.slice(0, 7)
}

/** 지급월의 원천세 신고·납부 기한입니다. 다음 달 10일입니다. */
export function withholdingDeadlineOf(paymentMonth: string): string {
  return `${addMonths(paymentMonth, 1)}-10`
}

/** 추가 대장 판정에 쓰는 같은 회사 급여대장의 요약입니다. */
export interface LedgerSummary {
  kind: 'REGULAR' | 'ADDITIONAL'
  attributionMonth: string
  status: LedgerStatus
}

/**
 * 추가 급여대장을 만들 수 있는지 판정합니다(매뉴얼 "추가 급여 생성").
 *
 * 1. 그 귀속월에 정기 대장이 있어야 합니다
 * 2. 정기 대장이 입력 중(`DRAFT`)이 아니어야 합니다(계산중 또는 완료)
 * 3. 회사에 입력 중인 대장이 하나도 없어야 합니다
 * 4. 지급월 원천세가 신고되지 않았어야 합니다
 * 5. 원천세 신고 기한(다음 달 10일) 5일 전부터는 만들 수 없습니다
 *
 * @returns 처음 걸린 규칙, 만들 수 있으면 `null`
 */
export function additionalLedgerBlocker(input: {
  attributionMonth: string
  paymentDate: string
  today: string
  ledgers: readonly LedgerSummary[]
  withholdingFiled: boolean
}): AdditionalLedgerBlocker | null {
  const regular = input.ledgers.find(
    (ledger) => ledger.kind === 'REGULAR' && ledger.attributionMonth === input.attributionMonth,
  )
  if (regular === undefined) return 'NO_REGULAR_LEDGER'
  if (regular.status === 'DRAFT') return 'REGULAR_LEDGER_NOT_SUBMITTED'
  if (input.ledgers.some((ledger) => ledger.status === 'DRAFT')) return 'DRAFT_LEDGER_EXISTS'
  if (input.withholdingFiled) return 'WITHHOLDING_FILED'
  const deadline = withholdingDeadlineOf(paymentMonthOf(input.paymentDate))
  if (input.today >= addDays(deadline, -ADDITIONAL_LEDGER_DEADLINE_MARGIN_DAYS)) return 'WITHHOLDING_DEADLINE_NEAR'
  return null
}

/** 근로소득 중복 판정에 쓰는 기존 행입니다. */
export interface WageRowRef {
  ledgerId: string
  attributionMonth: string
  employeeId: string
}

/**
 * 같은 귀속월에 그 직원의 근로소득 행이 이미 있는지 찾습니다. 근로소득은 직원·귀속월마다 한 행입니다.
 *
 * @returns 이미 있는 행의 대장 ID, 없으면 `null`
 */
export function duplicatedWageIncome(
  existing: readonly WageRowRef[],
  candidate: { attributionMonth: string; employeeId: string },
): string | null {
  const found = existing.find(
    (row) => row.attributionMonth === candidate.attributionMonth && row.employeeId === candidate.employeeId,
  )
  return found === undefined ? null : found.ledgerId
}

function dayInMonth(month: string, day: number): string {
  const last = lastDayOfMonth(month)
  return Number(last.slice(8)) < day ? last : `${month}-${String(day).padStart(2, '0')}`
}
