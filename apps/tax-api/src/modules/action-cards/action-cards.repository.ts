import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne } from '../../db/query'
import type { MenuCode } from '../access/access.types'
import type { ActionCardKind, ActionCardRow, ActionCardStatus, ActionCardSummary, OpenCardInput } from './action-cards.types'

type CardEventType = 'created' | 'completed' | 'skipped' | 'reopened' | 'closed_by_system'

/** Opens a card, or reopens the existing card with the same source and kind. */
export function openCard(db: DatabaseSync, input: OpenCardInput, now: string): void {
  const existing = queryOne<ActionCardRow>(
    db,
    'SELECT * FROM action_cards WHERE company_id = ? AND source_type = ? AND source_id = ? AND kind = ?',
    [input.companyId, input.sourceType, input.sourceId, input.kind],
  )
  if (existing === undefined) {
    const id = randomUUID()
    execute(
      db,
      `INSERT INTO action_cards (id, company_id, source_type, source_id, kind, menu_code, title, cta_path, due_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [id, input.companyId, input.sourceType, input.sourceId, input.kind, input.menuCode, input.title, input.ctaPath, input.dueDate, now],
    )
    insertCardEvent(db, id, 'created', null, now)
    return
  }
  const reopening = existing.status !== 'open'
  execute(
    db,
    `UPDATE action_cards SET status = 'open', completed_at = NULL, title = ?, due_date = ?, reopen_count = reopen_count + ?
     WHERE id = ?`,
    [input.title, input.dueDate, reopening ? 1 : 0, existing.id],
  )
  if (reopening) insertCardEvent(db, existing.id, 'reopened', null, now)
}

/** Closes the open card of a source and kind as done, if there is one. */
export function closeCardBySystem(db: DatabaseSync, companyId: string, sourceId: string, kind: ActionCardKind, now: string): void {
  const card = queryOne<ActionCardRow>(
    db,
    "SELECT * FROM action_cards WHERE company_id = ? AND source_type = 'tax_filing' AND source_id = ? AND kind = ? AND status = 'open'",
    [companyId, sourceId, kind],
  )
  if (card === undefined) return
  execute(db, "UPDATE action_cards SET status = 'done', completed_at = ? WHERE id = ?", [now, card.id])
  insertCardEvent(db, card.id, 'closed_by_system', null, now)
}

/** Closes every open card of a source, for cancelled filings. */
export function closeAllCardsOfSource(db: DatabaseSync, companyId: string, sourceId: string, now: string): void {
  const cards = queryAll<ActionCardRow>(
    db,
    "SELECT * FROM action_cards WHERE company_id = ? AND source_type = 'tax_filing' AND source_id = ? AND status = 'open'",
    [companyId, sourceId],
  )
  for (const card of cards) {
    execute(db, "UPDATE action_cards SET status = 'done', completed_at = ? WHERE id = ?", [now, card.id])
    insertCardEvent(db, card.id, 'closed_by_system', null, now)
  }
}

/** Finds a card within a company. */
export function findCard(db: DatabaseSync, companyId: string, cardId: string): ActionCardRow | undefined {
  return queryOne<ActionCardRow>(db, 'SELECT * FROM action_cards WHERE company_id = ? AND id = ?', [companyId, cardId])
}

/**
 * Closes an open card on a user's request.
 *
 * @returns Whether the card was still open.
 */
export function completeCard(db: DatabaseSync, cardId: string, status: Exclude<ActionCardStatus, 'open'>, userId: string, now: string): boolean {
  const changes = execute(
    db,
    "UPDATE action_cards SET status = ?, completed_at = ? WHERE id = ? AND status = 'open'",
    [status, now, cardId],
  )
  if (changes > 0) insertCardEvent(db, cardId, status === 'done' ? 'completed' : 'skipped', userId, now)
  return changes > 0
}

/** Lists cards in one tab, restricted to menu codes the user may open. */
export function listCards(
  db: DatabaseSync,
  companyId: string,
  tab: 'active' | 'archived',
  menuCodes: readonly MenuCode[],
  limit: number,
  offset: number,
): { rows: ActionCardRow[]; count: number } {
  if (menuCodes.length === 0) return { rows: [], count: 0 }
  const statusClause = tab === 'active' ? "status = 'open'" : "status IN ('done', 'skipped_overdue')"
  const order = tab === 'active' ? 'due_date IS NULL, due_date, created_at, id' : 'completed_at DESC, id DESC'
  const where = `company_id = ? AND ${statusClause} AND menu_code IN (${placeholders(menuCodes.length)})`
  const params = [companyId, ...menuCodes]
  const rows = queryAll<ActionCardRow>(db, `SELECT * FROM action_cards WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset,
  ])
  const total = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM action_cards WHERE ${where}`, params)
  return { rows, count: total?.n ?? 0 }
}

/** Counts cards per tab and finds the nearest open deadline. */
export function summarizeCards(db: DatabaseSync, companyId: string, menuCodes: readonly MenuCode[]): ActionCardSummary {
  if (menuCodes.length === 0) return { active_count: 0, archived_count: 0, nearest_due_date: null }
  const row = queryOne<ActionCardSummary>(
    db,
    `SELECT
       COALESCE(SUM(status = 'open'), 0) AS active_count,
       COALESCE(SUM(status <> 'open'), 0) AS archived_count,
       MIN(CASE WHEN status = 'open' THEN due_date END) AS nearest_due_date
     FROM action_cards WHERE company_id = ? AND menu_code IN (${placeholders(menuCodes.length)})`,
    [companyId, ...menuCodes],
  )
  return row ?? { active_count: 0, archived_count: 0, nearest_due_date: null }
}

function insertCardEvent(db: DatabaseSync, cardId: string, type: CardEventType, actorId: string | null, now: string): void {
  execute(db, 'INSERT INTO action_card_events (card_id, type, actor_id, created_at) VALUES (?, ?, ?, ?)', [cardId, type, actorId, now])
}
