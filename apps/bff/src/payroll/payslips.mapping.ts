import { LegacyError, legacyErrors } from '../legacy-error.ts'
import type { Payslip, PayslipFailureReason, PayslipSendJob, PayrollLedger, PayrollRow } from '../upstream.types.ts'
import { legacySegment, toLegacyRow } from './ledgers.mapping.ts'

/**
 * 현행 급여카드 명세서(`cards/:c/payslip/…`) ↔ 새 명세서(`/v1/payslips`) 번역입니다.
 *
 * 새 명세서는 마감된 대장 행의 보기라 마감 전에는 없고, 발송 기록은 마지막 한 번(`delivery`)만 보입니다. 현행 명세서 이메일
 * 덮어쓰기와 계산식 문구(`payment_formulas`)는 새 API에 자리가 없습니다. 이메일은 HR 직원 정보가 받는 주소입니다.
 */

/** 현행 발송 상태입니다. 현행 `in_flight`는 새 API의 발송이 동기라 나오지 않습니다. */
export type LegacyNotificationStatus = 'success' | 'fail'

/** 현행 요청이 한 번에 보내는 최대 행 수입니다(현행 zod `max(500)`). */
export const MAX_PAYSLIP_ROWS = 500

/** 새 급여대장 행 ID입니다. */
const ROW_ID = /^pyr_[0-9A-HJKMNP-TV-Z]{26}$/

/** 현행 zod `z.email()`처럼 형식만 봅니다. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const NOT_ON_CARD = 'Some rows are not on this payroll card.'

const UNSUPPORTED = 'Not supported by the new API yet.'

/** 현행 근로소득 행(`wage_salary`)인지 봅니다. 현행 명세서 화면은 근로소득 행만 보여 줬습니다. */
export function isWageRow(row: PayrollRow): boolean {
  return legacySegment(row.incomeType) === 'wage-salary'
}

/** 새 발송 결과 → 현행 `notification_status`입니다. 보낸 적 없으면 `null`(미발송)입니다. */
export function legacyNotificationStatus(payslip: Payslip | undefined): LegacyNotificationStatus | null {
  const status = payslip?.delivery.status
  if (status === 'SENT') return 'success'
  if (status === 'FAILED') return 'fail'
  return null
}

/** 새 실패 사유 → 현행 `fail_reason`입니다. 현행은 주소가 없으면 `no_email`, 그 밖은 메일 연동의 문구였습니다. */
export function legacyFailReason(reason: PayslipFailureReason | null | undefined): string | null {
  if (reason === 'NO_EMAIL') return 'no_email'
  if (reason === 'REJECTED') return 'rejected'
  return null
}

/**
 * 현행 `sent_at`(마지막으로 성공한 시각)입니다. 새 API는 마지막 시도만 보여 주므로, 마지막 시도가 성공일 때만 그 시각이고
 * 성공한 뒤 실패한 명세서는 `null`입니다.
 */
export function legacySentAt(payslip: Payslip | undefined): string | null {
  return payslip?.delivery.status === 'SENT' ? payslip.delivery.attemptedAt : null
}

/**
 * 현행 `GET cards/:c/payslip`의 근로소득 행입니다. 현행 행에 명세서 이메일·계산식·발송 상태를 더합니다.
 *
 * @param email 새 API가 이 행의 명세서를 보낼 주소(HR 직원 이메일)입니다. 모르면 `null`입니다.
 */
export function toLegacyPayslipRow(
  ledger: PayrollLedger,
  row: PayrollRow,
  payslip: Payslip | undefined,
  email: string | null,
): Record<string, unknown> {
  return {
    ...toLegacyRow(ledger, row),
    email,
    payslip_email: email,
    // 새 API는 계산식 문구를 따로 두지 않습니다. 계산식은 행 계산 결과(`calculation.payments[].formula`)에 있습니다.
    payment_formulas: {},
    notification_status: legacyNotificationStatus(payslip),
  }
}

/** 현행 `GET …/payslip/wage-salary/notifications`의 항목입니다. */
export function toLegacyNotification(row: PayrollRow, payslip: Payslip | undefined): Record<string, unknown> {
  return {
    row_id: row.id,
    name: row.payeeName,
    status: legacyNotificationStatus(payslip),
    fail_reason: legacyFailReason(payslip?.delivery.failureReason),
    sent_at: legacySentAt(payslip),
  }
}

/** 행 하나의 발송 결과입니다. 현행 급여카드는 이 모양 그대로, BPO는 `status`를 `notification_status`로 줍니다. */
export interface LegacySendResult {
  row_id: string
  status: LegacyNotificationStatus
  fail_reason: string | null
}

/**
 * 새 발송 작업 → 현행 `POST …/notifications`의 결과입니다. 새 API는 보낸 명세서 순서로 답합니다.
 *
 * 새 API는 같은 회사·사용자·키에 다른 본문이면 422로 거절하고 BFF는 키를 세션·대상에 묶으므로 일어나지 않아야 하는 방어선입니다.
 * 작업의 명세서가 요청한 명세서와 다르면 요청한 명세서는 나가지 않았으므로 성공처럼 보이지 않게 422 `IDEMPOTENCY_KEY_REUSED`로 거절합니다. 현행에는 멱등 키가 없어 따를 선례가 없고, 새 API가
 * 같은 키·다른 본문에 주는 상태(422)와 같게 둡니다.
 *
 * @param requested 요청한 명세서 ID → 행 ID입니다.
 */
export function toLegacySendResults(job: PayslipSendJob, requested: ReadonlyMap<string, string>): LegacySendResult[] {
  const sent = new Set(job.result.items.map((item) => item.payslipId))
  if (sent.size !== requested.size || [...requested.keys()].some((id) => !sent.has(id))) {
    throw new LegacyError(422, {
      detail: 'This Idempotency-Key was already used for a different send. Send again with a new key.',
      code: 'IDEMPOTENCY_KEY_REUSED',
    })
  }
  return job.result.items.map((item) => ({
    row_id: requested.get(item.payslipId) as string,
    status: item.status === 'SENT' ? 'success' : 'fail',
    fail_reason: legacyFailReason(item.failureReason),
  }))
}

/**
 * 현행 발송 본문의 `row_ids`를 읽습니다. 현행처럼 1–500개의 ID이고 같은 ID는 한 번으로 봅니다. 카드에 있는 행인지(새 행 ID
 * 형식 포함)는 현행처럼 카드 404·마감 전 409 뒤에 라우트가 봅니다({@link assertRowIdFormat}).
 */
export function parseRowIds(body: Record<string, unknown>): string[] {
  const value = body['row_ids']
  if (value === undefined || value === null) throw legacyErrors.invalidField('row_ids', 'This field is required.')
  if (!Array.isArray(value)) throw legacyErrors.invalidField('row_ids', 'Expected a list.')
  if (value.length < 1 || value.length > MAX_PAYSLIP_ROWS) {
    throw legacyErrors.invalidField('row_ids', `Ensure this list has 1 to ${MAX_PAYSLIP_ROWS} items.`)
  }
  value.forEach((id, index) => {
    if (typeof id !== 'string') throw legacyErrors.invalidField(`row_ids.${index}`, 'Invalid value.')
  })
  return [...new Set(value as string[])]
}

/** 새 행 ID 형식이 아닌 ID는 이 카드의 행일 수 없으므로 명세서를 읽기 전에 현행 문구로 422입니다. */
export function assertRowIdFormat(ids: readonly string[]): void {
  if (!ids.every((id) => ROW_ID.test(id))) throw rowsNotOnCard()
}

/** 현행 행 선택이 카드에 없는 행을 담았을 때의 422입니다. */
export function rowsNotOnCard(): ReturnType<typeof legacyErrors.invalidField> {
  return legacyErrors.invalidField('row_ids', NOT_ON_CARD)
}

/** 현행 `POST cards/:c/payslip`의 항목 하나입니다. */
export interface PayslipSaveEntry {
  index: number
  id: string
  /** 보낸 이메일입니다. 빠졌거나 `null`(덮어쓰기 없음)이면 `undefined`입니다. */
  email: string | undefined
}

/**
 * 현행 `POST cards/:c/payslip` 본문 `{ wage_salary: [{ id, email?, payment_formulas? }] }`을 읽습니다.
 *
 * 새 API에는 명세서 이메일 덮어쓰기와 계산식 문구가 없습니다. 비지 않은 `payment_formulas`는 여기서 422이고, 이메일은 지금 HR
 * 주소와 같은지 라우트가 비교합니다(현행 화면이 받은 주소를 그대로 돌려보내면 받아야 하므로).
 */
export function parsePayslipSave(body: Record<string, unknown>): PayslipSaveEntry[] {
  const list = body['wage_salary']
  if (list === undefined || list === null) throw legacyErrors.invalidField('wage_salary', 'This field is required.')
  if (!Array.isArray(list)) throw legacyErrors.invalidField('wage_salary', 'Expected a list.')
  if (list.length > MAX_PAYSLIP_ROWS) {
    throw legacyErrors.invalidField('wage_salary', `Ensure this list has at most ${MAX_PAYSLIP_ROWS} items.`)
  }
  return list.map((entry: unknown, index) => {
    const field = (name: string) => `wage_salary.${index}.${name}`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw legacyErrors.invalidField(`wage_salary.${index}`, 'Invalid value.')
    }
    const item = entry as Record<string, unknown>
    const id = item['id']
    if (id === undefined || id === null) throw legacyErrors.invalidField(field('id'), 'This field is required.')
    if (typeof id !== 'string') throw legacyErrors.invalidField(field('id'), 'Invalid value.')
    const email = item['email']
    if (email !== undefined && email !== null && (typeof email !== 'string' || !EMAIL.test(email))) {
      throw legacyErrors.invalidField(field('email'), 'Invalid email address.')
    }
    const formulas = item['payment_formulas']
    if (formulas !== undefined) {
      if (typeof formulas !== 'object' || formulas === null || Array.isArray(formulas)) {
        throw legacyErrors.invalidField(field('payment_formulas'), 'Invalid value.')
      }
      if (Object.keys(formulas).length > 0) throw legacyErrors.invalidField(field('payment_formulas'), UNSUPPORTED)
    }
    return { index, id, email: typeof email === 'string' ? email : undefined }
  })
}

/** 현행 명세서 이메일 덮어쓰기가 지금 HR 주소와 다를 때의 422입니다. */
export function unsupportedEmail(index: number): ReturnType<typeof legacyErrors.invalidField> {
  return legacyErrors.invalidField(`wage_salary.${index}.email`, UNSUPPORTED)
}
