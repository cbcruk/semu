/**
 * 급여 컨텍스트가 다른 컨텍스트에 공개하는 것입니다. 다른 컨텍스트는 이 파일만 가져옵니다.
 *
 * - Tax: 지급월 이벤트(`payroll_pay_month.closed`·`payroll_pay_month.reopened`·`payroll_pay_month.withholding_changed`)를 구독하고,
 *   `PayrollLedgerSummary`로 지급일 구간의 마감 현황을, `PayrollWithholdingTotals`로 지급월의 소득 종류별 원천세 합계를
 *   읽고, `WithholdingFilingLock` 포트를 구현합니다
 * - Bookkeeping: `PayrollLaborCost`로 월별 인건비를 읽습니다
 * - HR: `PayrollEmployeeDirectory` 포트를 구현하고, `SeveranceSettlementQuery`로 직원의 퇴직금 정산 상태를 묻습니다
 */
export type {
  PayMonthClosed,
  PayMonthReopened,
  PayMonthWithholdingChanged,
  PayrollEvent,
} from './ports/payroll-events.types.ts'
export type { OtherIncomeCategory, WithholdingIncomeKind, WithholdingSummaryLine } from './ledgers/pay-month.types.ts'
export { PayrollEventPublisher } from './ports/payroll-events.ts'
export { PayrollLaborCost } from './labor-cost/payroll-labor-cost.ts'
export { PayrollLedgerSummary, type PayrollLedgerCount } from './ledgers/payroll-ledger-summary.ts'
export { PayrollWithholdingTotals } from './ledgers/payroll-withholding-totals.ts'
export type { LaborCostMonth, LaborCostReport } from './labor-cost/labor-cost.types.ts'
export {
  PayrollEmployeeDirectory,
  type EmploymentTrend,
  type PayrollEmployee,
} from './ports/payroll-employee-directory.ts'
export { WithholdingFilingLock } from './ports/withholding-filing-lock.ts'
export { SeveranceSettlementQuery } from './severance/severance-settlement-query.ts'
export type { SeveranceStatus } from './severance/severance-settlement.types.ts'
export { PayslipMailer, type PayslipMailResult } from './ports/payslip-mailer.ts'
