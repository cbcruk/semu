import type { CardActor, CardStatus, CardTransitionName, CardTransitionRule } from './cards.types'

/**
 * The single source of truth for payroll card transitions (design part 2, 3절).
 *
 * - `confirmInput`: input is done (고객 "검토 요청" or 담당자 계산 확정); every row is recalculated.
 * - `reopenInput`: the agency sends a calculated card back for input.
 * - `requestApproval` → `approve` | `reject`: the agency asks, the client decides.
 * - `withdrawApprovalRequest`: the agency withdraws a pending request (`cancel-approval` before approval).
 * - `cancelApproval`: the client cancels an approval (`cancel-approval` after approval).
 * - `sendPayslips`, `exportToDesk`: closing steps; both keep the card closed.
 * - `legacyFix`, `legacyRelease`: legacy 확정 and 해제, done by the agency in desk.
 */
export const CARD_TRANSITIONS = {
  confirmInput: { from: ['inputting'], to: 'calculated', actors: ['client', 'agency'], locksOnFiledWithholding: true },
  reopenInput: { from: ['calculated'], to: 'inputting', actors: ['agency'], locksOnFiledWithholding: true },
  requestApproval: { from: ['calculated'], to: 'approval_requested', actors: ['agency'], locksOnFiledWithholding: false },
  approve: { from: ['approval_requested'], to: 'approved', actors: ['client'], locksOnFiledWithholding: false },
  reject: { from: ['approval_requested'], to: 'calculated', actors: ['client'], locksOnFiledWithholding: true },
  withdrawApprovalRequest: { from: ['approval_requested'], to: 'calculated', actors: ['agency'], locksOnFiledWithholding: true },
  cancelApproval: { from: ['approved', 'payslips_sent'], to: 'approval_requested', actors: ['client'], locksOnFiledWithholding: true },
  sendPayslips: { from: ['approved', 'payslips_sent', 'exported'], to: 'payslips_sent', actors: ['client', 'agency'], locksOnFiledWithholding: false },
  exportToDesk: { from: ['approved', 'payslips_sent', 'exported'], to: 'exported', actors: ['agency'], locksOnFiledWithholding: false },
  legacyFix: { from: ['calculated'], to: 'approved', actors: ['agency'], locksOnFiledWithholding: false },
  legacyRelease: { from: ['calculated', 'approved', 'payslips_sent'], to: 'inputting', actors: ['agency'], locksOnFiledWithholding: true },
} as const satisfies Record<CardTransitionName, CardTransitionRule>

/** States that count as a closed ledger (`완료`) for withholding, payslips and reports. */
export const CLOSED_STATUSES: readonly CardStatus[] = ['approved', 'payslips_sent', 'exported']

/** States whose amounts feed labour cost reports (계산 완료 or later). */
export const CALCULATED_STATUSES: readonly CardStatus[] = ['calculated', 'approval_requested', 'approved', 'payslips_sent', 'exported']

/** Which actors may edit inputs in each state; later states are read-only for everyone. */
export const INPUT_EDITORS: Readonly<Record<CardStatus, readonly CardActor[]>> = {
  inputting: ['client', 'agency'],
  calculated: ['agency'],
  approval_requested: [],
  approved: [],
  payslips_sent: [],
  exported: [],
}

/** Progress step of the list screen's `n/3` label. */
export function stepOf(status: CardStatus): 1 | 2 | 3 {
  if (status === 'inputting') return 1
  if (CLOSED_STATUSES.includes(status)) return 3
  return 2
}

/** Whether a status counts as a closed ledger. */
export function isClosed(status: CardStatus): boolean {
  return CLOSED_STATUSES.includes(status)
}

/** Maps a card status to the legacy `card-status` value (입력가능 / 계산중 / 완료). */
export function legacyStatusOf(status: CardStatus): 'input_available' | 'calculating' | 'done' {
  if (status === 'inputting') return 'input_available'
  return isClosed(status) ? 'done' : 'calculating'
}
