import { legacyErrors } from '../legacy-error.ts'
import type { Payslip, PayrollIncomeType, PayrollLedger, PayrollRow } from '../upstream.types.ts'
import { bpoSegment, legacyCardStatus, toLegacySummary, toLegacyWork } from './ledgers.mapping.ts'
import { legacyFailReason, legacyNotificationStatus, legacySentAt } from './payslips.mapping.ts'
import type { LegacySendResult } from './payslips.mapping.ts'

/**
 * 현행 BPO 급여명세서(`bpo/card/:c/:group/payslip[/:rowId]`, `bpo/card/:c/payslip/send`) ↔ 새 명세서 번역입니다.
 *
 * 현행 BPO 명세서는 소득 묶음(`wage`·`business`·`daily`·`other`)마다 목록과 미리보기가 있었고, 근로 외 소득도 보냈습니다.
 * 새 명세서는 마감된 대장 행의 보기라, 묶음·금액·근무 정보는 대장 행에서 옮기고 발송 상태만 새 명세서에서 옮깁니다.
 */

/** 현행 BPO 명세서 묶음(경로의 `:group`)입니다. */
export type PayslipGroup = 'wage' | 'business' | 'daily' | 'other'

const GROUP: Record<PayrollIncomeType, PayslipGroup> = {
  WAGE_MONTHLY: 'wage',
  WAGE_DAILY: 'wage',
  WAGE_HOURLY: 'wage',
  DAILY: 'daily',
  BUSINESS: 'business',
  OTHER: 'other',
}

/**
 * 경로의 묶음을 읽습니다.
 *
 * @throws {LegacyError} 모르는 묶음이면 현행처럼 404 "Payslip group not found."
 */
export function parsePayslipGroup(value: string | undefined): PayslipGroup {
  if (value === 'wage' || value === 'business' || value === 'daily' || value === 'other') return value
  throw legacyErrors.notFound('Payslip group')
}

/** 행이 묶음에 드는지 봅니다. 근로(월급·일급·시급)는 `wage` 하나로 묶습니다. */
export function inGroup(row: PayrollRow, group: PayslipGroup): boolean {
  return GROUP[row.incomeType] === group
}

/**
 * 현행 BPO 명세서 목록의 항목입니다. 현행 `payslipSummary`와 같은 키입니다.
 *
 * 새 행에 없는 소득자 정보(생년월일·부서)는 `null`입니다(급여대장 조각과 같음). 발송 상태는 마감된 대장의 새 명세서에서 옵니다.
 *
 * @param email 새 API가 이 행의 명세서를 보낼 주소(HR 직원 이메일)입니다. 모르면 `null`입니다.
 */
export function toBpoPayslipSummary(
  row: PayrollRow,
  payslip: Payslip | undefined,
  email: string | null,
): Record<string, unknown> {
  return {
    row_id: row.id,
    id: row.id,
    name: row.payeeName,
    birth_date: null,
    income_type: bpoSegment(row.incomeType),
    payslip_group: GROUP[row.incomeType],
    department: null,
    email,
    notification_status: legacyNotificationStatus(payslip),
    sent_at: legacySentAt(payslip),
    fail_reason: legacyFailReason(payslip?.delivery.failureReason),
    net_pay: row.result?.netPay ?? 0,
  }
}

/**
 * 현행 BPO 명세서 미리보기입니다. 현행 `payslipDetail`과 같은 키입니다.
 *
 * - 금액과 지급·공제 줄은 행 계산 결과에서 옮깁니다. 새 명세서도 같은 결과의 보기라 값이 같고, 계산식(`formula`)은 행에만 있습니다.
 *   계산 전 행은 현행처럼 빈 줄과 0원입니다
 * - 근무 정보는 근로 행만이고 새 행의 분을 현행 시간으로 옮깁니다(`overtime_minutes` 90 → `overtime_hours` 1.5). 다른 행은 `null`입니다
 * - 회사가 고친 계산식 문구(`payment_formulas`)는 새 API에 없어 `{}`이고, 줄의 `formula`는 엔진의 계산식입니다
 */
export function toBpoPayslipDetail(
  ledger: PayrollLedger,
  row: PayrollRow,
  payslip: Payslip | undefined,
  email: string | null,
): Record<string, unknown> {
  const result = row.result
  return {
    ...toBpoPayslipSummary(row, payslip, email),
    attribution_month: ledger.attributionMonth,
    payment_date: ledger.paymentDate,
    payments: (result?.payments ?? []).map((line) => ({
      code: line.code,
      name: line.name,
      amount: line.amount,
      formula: line.formula,
    })),
    deductions: (result?.deductions ?? []).map((line) => ({
      code: line.code,
      name: line.name,
      amount: line.amount,
      formula: line.formula,
    })),
    work: GROUP[row.incomeType] === 'wage' ? toLegacyWork(row.input) : null,
    gross_pay: result?.grossPay ?? 0,
    deduction_total: result?.deductionTotal ?? 0,
    net_pay: result?.netPay ?? 0,
    payment_formulas: {},
  }
}

/**
 * 현행 BPO 카드 머리입니다. 현행 `serializeCard`와 같은 키입니다.
 *
 * 현행 급여카드 머리(`toLegacySummary`)에서 BPO에 없던 키(`attr_date`, `card_status`, `headcount`, `net_pay_total_by_type`)를
 * 빼고, `status`는 BPO 카드 상태(`inputting`·`calculated`·`approval_requested`·`approved`), `generation`은 `bpo`입니다.
 * 새 발송은 대장 상태를 바꾸지 않으므로 발송 뒤에도 `approved`이고 `payslips_sent_at`은 `null`입니다.
 */
export function toBpoCard(
  ledger: PayrollLedger,
  rows: readonly PayrollRow[],
  parentCardId: string | null,
): Record<string, unknown> {
  const {
    attr_date: _attrDate,
    card_status: _cardStatus,
    headcount: _headcount,
    net_pay_total_by_type: _netPayTotalByType,
    ...card
  } = toLegacySummary(ledger, rows, parentCardId)
  return { ...card, generation: 'bpo', status: legacyCardStatus(ledger.status) }
}

/** 행별 발송 결과 → 현행 BPO 발송 결과입니다. BPO는 상태 키가 `notification_status`였습니다. */
export function toBpoSendResults(results: readonly LegacySendResult[]): Array<Record<string, unknown>> {
  return results.map((result) => ({
    row_id: result.row_id,
    notification_status: result.status,
    fail_reason: result.fail_reason,
  }))
}
