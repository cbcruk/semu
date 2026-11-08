import type { Id } from '../../../shared/ids/ids.types.ts'

/**
 * 한 지급월에 지급일이 있는 급여대장이 모두 `CLOSED`가 됐습니다. Tax는 원천세 신고 건의
 * "급여대장 마감" 자료를 제출됨으로 바꿉니다. 원천세 금액은 싣지 않습니다. Tax는 신고서 줄이 필요할 때
 * `PayrollWithholdingTotals`로 그때의 값을 묻습니다(outbox 재전달·순서와 상관없이 같은 답).
 */
export interface PayMonthClosed {
  type: 'payroll_pay_month.closed'
  eventId: Id<'event'>
  companyId: Id<'company'>
  paymentMonth: string
  ledgerIds: ReadonlyArray<Id<'payrollLedger'>>
  occurredAt: string
}

/**
 * 마감됐던 지급월에 마감 해제·새 대장·지급일 이동이 생겨 더는 모두 마감이 아닙니다. Tax는 "급여대장 마감" 자료를
 * 다시 대기로 돌립니다.
 */
export interface PayMonthReopened {
  type: 'payroll_pay_month.reopened'
  eventId: Id<'event'>
  companyId: Id<'company'>
  paymentMonth: string
  occurredAt: string
}

/**
 * 대장의 마감 상태와 상관없이 지급월의 원천세 합계가 바뀌었습니다. 지금은 퇴직금 정산의 완료·다시 열기로 그 달의
 * 퇴직소득(`RETIREMENT`)이 생기거나 없어질 때 냅니다. 대장이 없는 달에도 냅니다.
 *
 * 금액과 정산 ID는 싣지 않습니다. 한 달에 퇴직자가 한 명이면 합계가 곧 개인의 퇴직금이고, Tax는 필요할 때
 * `PayrollWithholdingTotals`로 묻습니다. Tax는 마감 이벤트와 같은 채널로 받아 그 지급월의 신고 건을 다시 맞춥니다.
 */
export interface PayMonthWithholdingChanged {
  type: 'payroll_pay_month.withholding_changed'
  eventId: Id<'event'>
  companyId: Id<'company'>
  paymentMonth: string
  occurredAt: string
}

/** 급여가 내보내는 도메인 이벤트입니다. */
export type PayrollEvent = PayMonthClosed | PayMonthReopened | PayMonthWithholdingChanged
