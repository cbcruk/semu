import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { ClassificationCounts, EvidenceFilter, EvidenceRow, EvidenceSide, EvidenceSort } from './evidence.types'
import { EVIDENCE_TABLE } from './evidence.utils'

/** An evidence row joined with its partner name. */
export type EvidenceListRow = EvidenceRow & { partner_name: string | null }

const SORTS: Record<EvidenceSort, string> = {
  written_on: 'COALESCE(e.written_on, e.issued_on) ASC, e.id ASC',
  '-written_on': 'COALESCE(e.written_on, e.issued_on) DESC, e.id DESC',
  issued_on: 'e.issued_on ASC, e.id ASC',
  '-issued_on': 'e.issued_on DESC, e.id DESC',
  total_amount: 'total_sort ASC, e.id ASC',
  '-total_amount': 'total_sort DESC, e.id DESC',
}

/** Lists evidence of one side matching a filter. */
export function listEvidenceRows(
  db: DatabaseSync,
  companyId: string,
  side: EvidenceSide,
  filter: EvidenceFilter,
  sort: EvidenceSort,
  page: { limit: number; offset: number } | null,
): EvidenceListRow[] {
  const { where, params } = evidenceWhere(companyId, filter)
  return queryAll<EvidenceListRow>(
    db,
    `SELECT e.*, p.name AS partner_name, ${totalExpression(side)} AS total_sort
     FROM ${EVIDENCE_TABLE[side]} e LEFT JOIN partners p ON p.id = e.partner_id
     WHERE ${where} ORDER BY ${SORTS[sort]} ${page === null ? '' : 'LIMIT ? OFFSET ?'}`,
    page === null ? params : [...params, page.limit, page.offset],
  )
}

/** Counts matching evidence and the 전체 / 분류 완료 / 미분류 tabs, which ignore the classification filter. */
export function countEvidence(db: DatabaseSync, companyId: string, side: EvidenceSide, filter: EvidenceFilter): { count: number; counts: ClassificationCounts } {
  const { where, params } = evidenceWhere(companyId, filter)
  const tabs = evidenceWhere(companyId, { ...filter, classification: undefined })
  const table = EVIDENCE_TABLE[side]
  const count = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table} e LEFT JOIN partners p ON p.id = e.partner_id WHERE ${where}`, params)?.n ?? 0
  const row = queryOne<{ n: number; classified: number }>(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(e.account_title_id IS NOT NULL), 0) AS classified
     FROM ${table} e LEFT JOIN partners p ON p.id = e.partner_id WHERE ${tabs.where}`,
    tabs.params,
  )
  const all = row?.n ?? 0
  const classified = row?.classified ?? 0
  return { count, counts: { all, classified, unclassified: all - classified } }
}

/** Finds one evidence record with its partner name. */
export function findEvidenceRow(db: DatabaseSync, companyId: string, side: EvidenceSide, id: string): EvidenceListRow | undefined {
  return queryOne<EvidenceListRow>(
    db,
    `SELECT e.*, p.name AS partner_name FROM ${EVIDENCE_TABLE[side]} e LEFT JOIN partners p ON p.id = e.partner_id WHERE e.company_id = ? AND e.id = ?`,
    [companyId, id],
  )
}

/** Lists the IDs among `ids` that exist for the company. */
export function existingEvidenceIds(db: DatabaseSync, companyId: string, side: EvidenceSide, ids: readonly string[]): string[] {
  if (ids.length === 0) return []
  return queryAll<{ id: string }>(db, `SELECT id FROM ${EVIDENCE_TABLE[side]} WHERE company_id = ? AND id IN (${placeholders(ids.length)})`, [
    companyId,
    ...ids,
  ]).map((row) => row.id)
}

/** Writes manual changes onto evidence rows; absent keys stay unchanged. */
export function updateEvidenceManual(
  db: DatabaseSync,
  companyId: string,
  side: EvidenceSide,
  ids: readonly string[],
  values: { accountTitleId?: string | null; partnerId?: string | null; memo?: string | null; deductible?: 0 | 1 | null },
): number {
  if (ids.length === 0) return 0
  const sets: string[] = []
  const params: SqlValue[] = []
  if (values.accountTitleId !== undefined) {
    sets.push('account_title_id = ?', 'classified_by = ?', 'classified_rule_id = NULL')
    params.push(values.accountTitleId, values.accountTitleId === null ? null : 'manual')
  }
  if (values.partnerId !== undefined) {
    sets.push('partner_id = ?')
    params.push(values.partnerId)
  }
  if (values.memo !== undefined) {
    sets.push('memo = ?')
    params.push(values.memo)
  }
  if (values.deductible !== undefined && side === 'purchase') {
    sets.push('deductible = ?')
    params.push(values.deductible)
  }
  if (sets.length === 0) return 0
  return execute(db, `UPDATE ${EVIDENCE_TABLE[side]} SET ${sets.join(', ')} WHERE company_id = ? AND id IN (${placeholders(ids.length)})`, [
    ...params,
    companyId,
    ...ids,
  ])
}

function totalExpression(side: EvidenceSide): string {
  return side === 'sales' ? 'e.total_amount' : 'COALESCE(e.total_amount, e.supply_amount + e.vat_amount)'
}

function evidenceWhere(companyId: string, filter: EvidenceFilter): { where: string; params: SqlValue[] } {
  const conditions = ['e.company_id = ?', 'COALESCE(e.written_on, e.issued_on) BETWEEN ? AND ?']
  const params: SqlValue[] = [companyId, filter.start, filter.end]
  if (filter.sources.length > 0) {
    conditions.push(`e.source IN (${placeholders(filter.sources.length)})`)
    params.push(...filter.sources)
  }
  if (filter.classification === 'classified') conditions.push('e.account_title_id IS NOT NULL')
  if (filter.classification === 'unclassified') conditions.push('e.account_title_id IS NULL')
  if (filter.accountTitleIds.length > 0) {
    conditions.push(`e.account_title_id IN (${placeholders(filter.accountTitleIds.length)})`)
    params.push(...filter.accountTitleIds)
  }
  if (filter.docType !== undefined) {
    conditions.push('e.doc_type = ?')
    params.push(filter.docType)
  }
  if (filter.kind !== undefined) {
    conditions.push('e.kind = ?')
    params.push(filter.kind)
  }
  if (filter.partnerId !== undefined) {
    conditions.push('e.partner_id = ?')
    params.push(filter.partnerId)
  }
  if (filter.search !== undefined && filter.search.trim() !== '') {
    const term = `%${filter.search.trim()}%`
    conditions.push(
      "(COALESCE(e.counterparty_name, '') LIKE ? OR replace(COALESCE(e.counterparty_business_number, ''), '-', '') LIKE ? OR COALESCE(e.memo, '') LIKE ? OR COALESCE(p.name, '') LIKE ?)",
    )
    params.push(term, term.replace(/-/g, ''), term, term)
  }
  return { where: conditions.join(' AND '), params }
}
