import type { DatabaseSync } from 'node:sqlite'
import { addDays } from '../../lib/plain-date'
import { closeAllCardsOfSource, closeCardBySystem, openCard } from '../action-cards/action-cards.repository'
import type { ActionCardKind, OpenCardInput } from '../action-cards/action-cards.types'
import { TAX_TYPE_MENU_CODE } from '../access/menu-codes'
import type { FilingRow, TransitionName } from './filings.types'
import { ctaPathOf, periodLabel, TAX_TYPE_LABELS } from './filings.utils'

const CARD_TITLE_SUFFIX: Record<ActionCardKind, string> = {
  submit_materials: '자료 제출',
  confirm_ledger: '매입매출장 확인',
  review_filing_result: '신고 결과 확인',
  pay_tax: '납부',
}

/**
 * Opens and closes home cards after a filing transition, inside the caller's transaction.
 *
 * @param filing The filing as it is after the transition.
 */
export function applyCardEffects(db: DatabaseSync, name: TransitionName, filing: FilingRow, now: string): void {
  const open = (kind: ActionCardKind, dueDate: OpenCardInput['dueDate']): void => openCard(db, cardInput(filing, kind, dueDate), now)
  const close = (kind: ActionCardKind): void => closeCardBySystem(db, filing.company_id, filing.id, kind, now)
  switch (name) {
    case 'request':
    case 'reject':
    case 'unsubmit':
      open('submit_materials', filing.submit_due)
      return
    case 'submit':
    case 'startReview':
      close('submit_materials')
      return
    case 'uploadLedger':
      open('confirm_ledger', filing.due_date === null ? null : addDays(filing.due_date, -3))
      return
    case 'confirmLedger':
    case 'disputeLedger':
      close('confirm_ledger')
      return
    case 'file':
    case 'recordNotice':
      open('review_filing_result', filing.due_date ?? filing.payment_due)
      if ((filing.payable_amount ?? 0) > 0) open('pay_tax', filing.payment_due)
      return
    case 'pay':
    case 'close':
      close('pay_tax')
      return
    case 'cancel':
      closeAllCardsOfSource(db, filing.company_id, filing.id, now)
      return
    case 'startPreparing':
      return
  }
}

/** Closes the "review filing result" card once a client opens a return or notice. */
export function closeReviewCard(db: DatabaseSync, filing: FilingRow, now: string): void {
  closeCardBySystem(db, filing.company_id, filing.id, 'review_filing_result', now)
}

function cardInput(filing: FilingRow, kind: ActionCardKind, dueDate: OpenCardInput['dueDate']): OpenCardInput {
  return {
    companyId: filing.company_id,
    sourceType: 'tax_filing',
    sourceId: filing.id,
    kind,
    menuCode: TAX_TYPE_MENU_CODE[filing.tax_type],
    title: `${periodLabel(filing)} ${TAX_TYPE_LABELS[filing.tax_type]} ${CARD_TITLE_SUFFIX[kind]}`,
    ctaPath: ctaPathOf(filing.tax_type),
    dueDate,
  }
}
