import type { ServiceDeps } from '../../app.types'
import { transaction } from '../../db/query'
import { DomainError, notFound } from '../../lib/domain-error'
import type { PageRequest } from '../../lib/drf-pagination.types'
import { accessibleMenuCodes, decide } from '../access/access'
import type { AccessContext, MenuCode } from '../access/access.types'
import { MENU_DEFINITIONS } from '../access/menu-codes'
import { completeCard, findCard, listCards, summarizeCards } from './action-cards.repository'
import type { ActionCardRow, ActionCardSummary, CompletionReason } from './action-cards.types'

const ALL_MENU_CODES = Object.keys(MENU_DEFINITIONS) as MenuCode[]

/** Lists one tab of home cards, hiding cards whose menu the user cannot open. */
export function listActionCards(
  deps: ServiceDeps,
  companyId: string,
  access: AccessContext,
  tab: 'active' | 'archived',
  page: PageRequest,
): { rows: Record<string, unknown>[]; count: number } {
  const { rows, count } = listCards(deps.db, companyId, tab, accessibleMenuCodes(access, ALL_MENU_CODES), page.limit, page.offset)
  return { rows: rows.map(serializeCard), count }
}

/** Counts the home cards visible to a user. */
export function summarizeActionCards(deps: ServiceDeps, companyId: string, access: AccessContext): ActionCardSummary {
  return summarizeCards(deps.db, companyId, accessibleMenuCodes(access, ALL_MENU_CODES))
}

/**
 * Closes a card on the user's request.
 *
 * `done` always completes it. `skip` completes it when the deadline has not
 * passed (Asia/Seoul date) and otherwise records it as `skipped_overdue`.
 */
export function completeActionCard(
  deps: ServiceDeps,
  companyId: string,
  access: AccessContext,
  cardId: string,
  reason: CompletionReason,
): Record<string, unknown> {
  return transaction(deps.db, () => {
    const card = findCard(deps.db, companyId, cardId)
    if (card === undefined || !decide(access, card.menu_code).ok) throw notFound('Action card')
    if (card.status !== 'open') throw new DomainError('INVALID_TRANSITION', 'The card is already closed.')
    const today = deps.clock.today()
    const overdue = card.due_date !== null && today > card.due_date
    const status = reason === 'skip' && overdue ? 'skipped_overdue' : 'done'
    if (!completeCard(deps.db, card.id, status, access.userId, deps.clock.now())) {
      throw new DomainError('INVALID_TRANSITION', 'The card is already closed.')
    }
    const updated = findCard(deps.db, companyId, cardId)
    if (updated === undefined) throw notFound('Action card')
    return serializeCard(updated)
  })
}

function serializeCard(card: ActionCardRow): Record<string, unknown> {
  return {
    id: card.id,
    kind: card.kind,
    title: card.title,
    menu_code: card.menu_code,
    cta_path: card.cta_path,
    due_date: card.due_date,
    status: card.status,
    reopen_count: card.reopen_count,
    source_type: card.source_type,
    source_id: card.source_id,
    created_at: card.created_at,
    completed_at: card.completed_at,
  }
}
