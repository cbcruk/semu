import type { Id } from '../../../shared/ids/ids.types.ts'

/** 원천세 집계의 소득 종류입니다. Tax가 신고서 코드(A01·A03·A25·A40 등)로 바꿉니다. */
export type WithholdingIncomeKind = 'WAGE' | 'DAILY' | 'BUSINESS' | 'OTHER'

/** 지급월 원천세 집계의 한 줄입니다. */
export interface WithholdingSummaryLine {
  incomeKind: WithholdingIncomeKind
  headcount: number
  grossPay: number
  taxablePay: number
  incomeTax: number
  localIncomeTax: number
}

/**
 * 한 지급월에 지급일이 있는 급여대장이 모두 `CLOSED`가 됐습니다. Tax는 원천세 신고 건의
 * "급여대장 마감" 자료를 제출됨으로 바꿉니다. `withholding`은 싣기만 하고 지금 Tax는 쓰지 않습니다
 * (`wiring/payroll-tax.ts`가 회사와 지급월만 넘김). 신고서 초안에 쓰는 것은 미구현입니다.
 */
export interface PayMonthClosed {
  type: 'payroll_pay_month.closed'
  eventId: Id<'event'>
  companyId: Id<'company'>
  paymentMonth: string
  ledgerIds: ReadonlyArray<Id<'payrollLedger'>>
  withholding: ReadonlyArray<WithholdingSummaryLine>
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

/** 급여가 내보내는 도메인 이벤트입니다. */
export type PayrollEvent = PayMonthClosed | PayMonthReopened
