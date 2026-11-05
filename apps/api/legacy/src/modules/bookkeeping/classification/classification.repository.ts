import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { BankTransactionRow } from '../bank/bank.types'
import { bankFacts } from '../bank/bank.utils'
import type { EvidenceRow } from '../evidence/evidence.types'
import { EVIDENCE_TABLE, evidenceFacts } from '../evidence/evidence.utils'
import type { ClassifiableRow, RuleApplyJob, RuleRow, RuleScope, RuleUpdate } from './classification.types'

/** Table that holds the rows of each rule scope. */
export const SCOPE_TABLE: Record<RuleScope, 'sales_evidence' | 'purchase_evidence' | 'bank_transactions'> = {
  sales: EVIDENCE_TABLE.sales,
  purchase: EVIDENCE_TABLE.purchase,
  bank: 'bank_transactions',
}

/** Lists a company's rules of one scope in priority order. */
export function listRuleRows(db: DatabaseSync, companyId: string, scope: RuleScope, includeHidden: boolean): RuleRow[] {
  return queryAll<RuleRow>(
    db,
    `SELECT * FROM classification_rules WHERE company_id = ? AND scope = ? ${includeHidden ? '' : 'AND is_hidden = 0'} ORDER BY priority, created_at, id`,
    [companyId, scope],
  )
}

/** Finds one rule of a company. */
export function findRuleRow(db: DatabaseSync, companyId: string, id: string): RuleRow | undefined {
  return queryOne<RuleRow>(db, 'SELECT * FROM classification_rules WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Inserts a rule row. */
export function insertRuleRow(db: DatabaseSync, row: RuleRow): void {
  execute(
    db,
    `INSERT INTO classification_rules (id, company_id, scope, source, name, conditions, result_account_title_id, result_partner_id, priority, is_hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.company_id,
      row.scope,
      row.source,
      row.name,
      row.conditions,
      row.result_account_title_id,
      row.result_partner_id,
      row.priority,
      row.is_hidden,
      row.created_at,
      row.updated_at,
    ],
  )
}

/** Replaces the editable fields of a rule. */
export function updateRuleRow(db: DatabaseSync, row: RuleRow): void {
  execute(
    db,
    `UPDATE classification_rules SET source = ?, name = ?, conditions = ?, result_account_title_id = ?, result_partner_id = ?, is_hidden = ?, updated_at = ?
     WHERE company_id = ? AND id = ?`,
    [row.source, row.name, row.conditions, row.result_account_title_id, row.result_partner_id, row.is_hidden, row.updated_at, row.company_id, row.id],
  )
}

/** Deletes a rule; rows it classified keep their values and lose the rule reference. */
export function deleteRuleRow(db: DatabaseSync, companyId: string, id: string): number {
  return execute(db, 'DELETE FROM classification_rules WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Sets a rule's priority. */
export function setRulePriority(db: DatabaseSync, companyId: string, id: string, priority: number, now: string): void {
  execute(db, 'UPDATE classification_rules SET priority = ?, updated_at = ? WHERE company_id = ? AND id = ?', [priority, now, companyId, id])
}

/** Returns the priority after the last rule of a scope. */
export function nextPriority(db: DatabaseSync, companyId: string, scope: RuleScope): number {
  return (queryOne<{ n: number | null }>(db, 'SELECT MAX(priority) AS n FROM classification_rules WHERE company_id = ? AND scope = ?', [companyId, scope])?.n ?? 0) + 1
}

/**
 * Loads rows of a scope with the facts rules match against.
 *
 * @param ids Limits the load to these rows; all rows of the company when omitted.
 */
export function loadClassifiableRows(db: DatabaseSync, companyId: string, scope: RuleScope, ids?: readonly string[]): ClassifiableRow[] {
  if (ids !== undefined && ids.length === 0) return []
  const params: SqlValue[] = [companyId, ...(ids ?? [])]
  const filter = ids === undefined ? '' : `AND id IN (${placeholders(ids.length)})`
  if (scope === 'bank') {
    return queryAll<BankTransactionRow>(db, `SELECT * FROM bank_transactions WHERE company_id = ? ${filter} ORDER BY transacted_at, id`, params).map((row) => ({
      id: row.id,
      facts: bankFacts(row),
      account_title_id: row.account_title_id,
      partner_id: row.partner_id,
      classified_by: row.classified_by,
    }))
  }
  return queryAll<EvidenceRow>(db, `SELECT * FROM ${SCOPE_TABLE[scope]} WHERE company_id = ? ${filter} ORDER BY issued_on, id`, params).map((row) => ({
    id: row.id,
    facts: evidenceFacts(row),
    account_title_id: row.account_title_id,
    partner_id: row.partner_id,
    classified_by: row.classified_by,
  }))
}

/** Writes a rule's classification onto one row, marking it as rule-classified when the account title changes. */
export function writeRuleClassification(db: DatabaseSync, companyId: string, scope: RuleScope, rowId: string, ruleId: string, update: RuleUpdate): void {
  const sets: string[] = []
  const params: SqlValue[] = []
  if (update.accountTitleId !== undefined) {
    sets.push("account_title_id = ?, classified_by = 'rule', classified_rule_id = ?")
    params.push(update.accountTitleId, ruleId)
  }
  if (update.partnerId !== undefined) {
    sets.push('partner_id = ?')
    params.push(update.partnerId)
  }
  if (sets.length === 0) return
  execute(db, `UPDATE ${SCOPE_TABLE[scope]} SET ${sets.join(', ')} WHERE company_id = ? AND id = ?`, [...params, companyId, rowId])
}

/** Inserts a rule application job. */
export function insertApplyJob(db: DatabaseSync, job: RuleApplyJob): void {
  execute(
    db,
    `INSERT INTO rule_apply_jobs (id, company_id, scope, rule_id, mode, status, total, processed, updated, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [job.id, job.company_id, job.scope, job.rule_id, job.mode, job.status, job.total, job.processed, job.updated, job.created_at, job.finished_at],
  )
}

/** Finds a rule application job of a company. */
export function findApplyJob(db: DatabaseSync, companyId: string, id: string): RuleApplyJob | undefined {
  return queryOne<RuleApplyJob>(db, 'SELECT * FROM rule_apply_jobs WHERE company_id = ? AND id = ?', [companyId, id])
}
