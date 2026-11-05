import type { FilingStatus, TransitionName, TransitionRule } from './filings.types'

/** The single source of truth for filing state transitions. */
export const TRANSITIONS = {
  request: { from: ['scheduled'], to: 'requested', actor: 'agency' },
  submit: { from: ['requested'], to: 'submitted', actor: 'client', guard: 'noPendingClientItems' },
  unsubmit: { from: ['submitted'], to: 'requested', actor: 'client' },
  startReview: { from: ['scheduled', 'requested', 'submitted'], to: 'reviewing', actor: 'agency' },
  reject: { from: ['reviewing'], to: 'requested', actor: 'agency' },
  uploadLedger: { from: ['reviewing'], to: 'ledger_pending', actor: 'agency', guard: 'isSurtax' },
  confirmLedger: { from: ['ledger_pending'], to: 'preparing', actor: 'client' },
  disputeLedger: { from: ['ledger_pending'], to: 'reviewing', actor: 'client' },
  startPreparing: { from: ['reviewing'], to: 'preparing', actor: 'agency', guard: 'isNotSurtax' },
  file: { from: ['preparing'], to: 'filed', actor: 'agency', guard: 'hasReturnDocument' },
  recordNotice: { from: ['scheduled'], to: 'filed', actor: 'agency', guard: 'isNoticeKind' },
  pay: { from: ['filed'], to: 'settled', actor: 'client', guard: 'payableIsPositive' },
  close: { from: ['filed'], to: 'settled', actor: 'agency', guard: 'payableIsNotPositive' },
  cancel: { from: ['scheduled', 'requested'], to: 'cancelled', actor: 'agency' },
} as const satisfies Record<TransitionName, TransitionRule>

/** States in which a client may edit requirement answers and files. */
export const CLIENT_EDITABLE_STATUSES: readonly FilingStatus[] = ['requested']

/** States that no longer count as open work. */
export const TERMINAL_STATUSES: readonly FilingStatus[] = ['settled', 'cancelled']

/** States before a return has been filed, used to derive `is_overdue`. */
export const PRE_FILING_STATUSES: readonly FilingStatus[] = [
  'scheduled',
  'requested',
  'submitted',
  'reviewing',
  'ledger_pending',
  'preparing',
]

/** Checks whether a transition may start from a status. */
export function canStartFrom(name: TransitionName, status: FilingStatus): boolean {
  const rule: TransitionRule = TRANSITIONS[name]
  return rule.from.includes(status)
}
