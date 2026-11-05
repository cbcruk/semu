import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../../db/query'
import { invalidField } from '../../../lib/domain-error'
import type { PartnerBankAccountRow, PartnerContactRow, PartnerRow, UnsettledAmounts } from './partners.types'

const PARTNER_SORTS: Record<string, string> = {
  created: 'created_at ASC, id ASC',
  '-created': 'created_at DESC, id DESC',
  name: 'name ASC, id ASC',
  '-name': 'name DESC, id DESC',
}

/** Finds a live partner of a company. */
export function findPartnerRow(db: DatabaseSync, companyId: string, id: string): PartnerRow | undefined {
  return queryOne<PartnerRow>(db, 'SELECT * FROM partners WHERE company_id = ? AND id = ? AND deleted_at IS NULL', [companyId, id])
}

/**
 * Checks that a partner exists in the company.
 *
 * @throws {DomainError} `VALIDATION_FAILED` on `partner_id` otherwise.
 */
export function requirePartner(db: DatabaseSync, companyId: string, id: string): PartnerRow {
  const partner = findPartnerRow(db, companyId, id)
  if (partner === undefined) throw invalidField('partner_id', 'Unknown partner.')
  return partner
}

/** Lists live partners matching a search over name, representative, business number and memo. */
export function listPartnerRows(
  db: DatabaseSync,
  companyId: string,
  filter: { search?: string | undefined; kind?: 'sales' | 'purchase' | undefined },
  sort: string,
  page: { limit: number; offset: number },
): { rows: PartnerRow[]; count: number } {
  const conditions = ['company_id = ?', 'deleted_at IS NULL']
  const params: SqlValue[] = [companyId]
  if (filter.search !== undefined && filter.search.trim() !== '') {
    const term = `%${filter.search.trim()}%`
    conditions.push("(name LIKE ? OR representative_name LIKE ? OR COALESCE(business_number, '') LIKE ? OR COALESCE(memo, '') LIKE ?)")
    params.push(term, term, term.replace(/-/g, ''), term)
  }
  if (filter.kind === 'sales') conditions.push('is_sales = 1')
  if (filter.kind === 'purchase') conditions.push('is_purchase = 1')
  const where = conditions.join(' AND ')
  return {
    rows: queryAll<PartnerRow>(db, `SELECT * FROM partners WHERE ${where} ORDER BY ${PARTNER_SORTS[sort] ?? PARTNER_SORTS['-created']} LIMIT ? OFFSET ?`, [
      ...params,
      page.limit,
      page.offset,
    ]),
    count: queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM partners WHERE ${where}`, params)?.n ?? 0,
  }
}

/** Inserts or replaces a partner row. */
export function savePartnerRow(db: DatabaseSync, row: PartnerRow): void {
  const columns = Object.keys(row) as (keyof PartnerRow)[]
  execute(
    db,
    `INSERT INTO partners (${columns.join(', ')}) VALUES (${placeholders(columns.length)})
     ON CONFLICT (id) DO UPDATE SET ${columns.filter((column) => column !== 'id').map((column) => `${column} = excluded.${column}`).join(', ')}`,
    columns.map((column) => row[column]),
  )
}

/** Replaces a partner's bank accounts. */
export function replacePartnerBankAccounts(db: DatabaseSync, partnerId: string, rows: readonly PartnerBankAccountRow[]): void {
  execute(db, 'DELETE FROM partner_bank_accounts WHERE partner_id = ?', [partnerId])
  for (const row of rows) {
    execute(
      db,
      'INSERT INTO partner_bank_accounts (id, partner_id, bank_code, account_number_enc, account_number_tail, account_name, bankbook_image_path, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [row.id, partnerId, row.bank_code, row.account_number_enc, row.account_number_tail, row.account_name, row.bankbook_image_path, row.seq],
    )
  }
}

/** Replaces a partner's contacts. */
export function replacePartnerContacts(db: DatabaseSync, partnerId: string, rows: readonly PartnerContactRow[]): void {
  execute(db, 'DELETE FROM partner_contacts WHERE partner_id = ?', [partnerId])
  for (const row of rows) {
    execute(
      db,
      'INSERT INTO partner_contacts (id, partner_id, name, department, email, phone_number, mobile_number, fax_number, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [row.id, partnerId, row.name, row.department, row.email, row.phone_number, row.mobile_number, row.fax_number, row.seq],
    )
  }
}

/** Lists the bank accounts of partners. */
export function listPartnerBankAccounts(db: DatabaseSync, partnerIds: readonly string[]): PartnerBankAccountRow[] {
  if (partnerIds.length === 0) return []
  return queryAll<PartnerBankAccountRow>(db, `SELECT * FROM partner_bank_accounts WHERE partner_id IN (${placeholders(partnerIds.length)}) ORDER BY seq`, [
    ...partnerIds,
  ])
}

/** Lists the contacts of partners. */
export function listPartnerContacts(db: DatabaseSync, partnerIds: readonly string[]): PartnerContactRow[] {
  if (partnerIds.length === 0) return []
  return queryAll<PartnerContactRow>(db, `SELECT * FROM partner_contacts WHERE partner_id IN (${placeholders(partnerIds.length)}) ORDER BY seq`, [...partnerIds])
}

/**
 * Computes the realtime unsettled amounts of partners.
 *
 * `unsettled = Σ classified evidence total − Σ settlement links`, per side.
 * Unclassified evidence is left out, matching the "분류 완료된 경우에만" rule of the realtime reports.
 */
export function unsettledAmounts(db: DatabaseSync, companyId: string, partnerIds: readonly string[]): Map<string, UnsettledAmounts> {
  const result = new Map(partnerIds.map((id) => [id, { unsettled_sales_amount: 0, unsettled_purchase_amount: 0 }]))
  if (partnerIds.length === 0) return result
  const inList = placeholders(partnerIds.length)
  const sides = [
    ['sales', 'sales_evidence', 'e.total_amount', 'unsettled_sales_amount'],
    ['purchase', 'purchase_evidence', 'COALESCE(e.total_amount, e.supply_amount + e.vat_amount)', 'unsettled_purchase_amount'],
  ] as const
  for (const [side, table, total, key] of sides) {
    const rows = queryAll<{ partner_id: string; amount: number }>(
      db,
      `SELECT e.partner_id, SUM(${total}) - COALESCE(SUM((SELECT SUM(l.amount) FROM settlement_links l
           WHERE l.company_id = e.company_id AND l.evidence_side = '${side}' AND l.evidence_id = e.id)), 0) AS amount
       FROM ${table} e WHERE e.company_id = ? AND e.account_title_id IS NOT NULL AND e.partner_id IN (${inList})
       GROUP BY e.partner_id`,
      [companyId, ...partnerIds],
    )
    for (const row of rows) {
      const entry = result.get(row.partner_id)
      if (entry !== undefined) entry[key] = row.amount
    }
  }
  return result
}

/** Returns the latest bank transaction time of each partner. */
export function lastTransactionTimes(db: DatabaseSync, companyId: string, partnerIds: readonly string[]): Map<string, string> {
  if (partnerIds.length === 0) return new Map()
  const rows = queryAll<{ partner_id: string; last: string }>(
    db,
    `SELECT partner_id, MAX(transacted_at) AS last FROM bank_transactions WHERE company_id = ? AND partner_id IN (${placeholders(partnerIds.length)}) GROUP BY partner_id`,
    [companyId, ...partnerIds],
  )
  return new Map(rows.map((row) => [row.partner_id, row.last]))
}

/**
 * Links evidence without a partner to the partner that has the same business number.
 *
 * @returns How many evidence rows were linked.
 */
export function linkEvidenceByBusinessNumber(db: DatabaseSync, companyId: string, partnerId: string, businessNumber: string): number {
  return ['sales_evidence', 'purchase_evidence'].reduce(
    (sum, table) =>
      sum +
      execute(
        db,
        `UPDATE ${table} SET partner_id = ? WHERE company_id = ? AND partner_id IS NULL AND replace(counterparty_business_number, '-', '') = ?`,
        [partnerId, companyId, businessNumber],
      ),
    0,
  )
}

/** Finds the partner whose business number matches, for linking collected evidence. */
export function findPartnerIdByBusinessNumber(db: DatabaseSync, companyId: string, businessNumber: string): string | null {
  return (
    queryOne<{ id: string }>(db, 'SELECT id FROM partners WHERE company_id = ? AND business_number = ? AND deleted_at IS NULL', [
      companyId,
      businessNumber.replace(/-/g, ''),
    ])?.id ?? null
  )
}

/** Reads a cached NTS business status lookup. */
export function findCachedBusinessStatus(
  db: DatabaseSync,
  businessNumber: string,
): { business_status: PartnerRow['business_status']; taxation_type: string | null; closed_on: string | null; checked_at: string } | undefined {
  return queryOne(db, 'SELECT business_status, taxation_type, closed_on, checked_at FROM partner_business_status_cache WHERE business_number = ?', [businessNumber])
}

/** Stores an NTS business status lookup. */
export function cacheBusinessStatus(
  db: DatabaseSync,
  businessNumber: string,
  status: { business_status: string; taxation_type: string | null; closed_on: string | null },
  now: string,
): void {
  execute(
    db,
    `INSERT INTO partner_business_status_cache (business_number, business_status, taxation_type, closed_on, checked_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (business_number) DO UPDATE SET business_status = excluded.business_status, taxation_type = excluded.taxation_type,
       closed_on = excluded.closed_on, checked_at = excluded.checked_at`,
    [businessNumber, status.business_status, status.taxation_type, status.closed_on, now],
  )
}
