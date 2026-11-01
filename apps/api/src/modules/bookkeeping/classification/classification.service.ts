import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../../app.types'
import { queryAll, transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import type { PageRequest } from '../../../lib/drf-pagination.types'
import { assertAssignable, loadAccountTitleIndex } from '../account-titles/account-titles.service'
import type { AccountScope } from '../account-titles/account-titles.types'
import { refreshSettlementStatuses } from '../bank/bank.repository'
import {
  deleteRuleRow,
  findApplyJob,
  findRuleRow,
  insertApplyJob,
  insertRuleRow,
  listRuleRows,
  loadClassifiableRows,
  nextPriority,
  setRulePriority,
  updateRuleRow,
  writeRuleClassification,
} from './classification.repository'
import type { ApplyMode, ClassifiableRow, CompiledRule, Rule, RuleApplyJob, RuleCondition, RuleRow, RuleScope } from './classification.types'
import { compileRule, conditionProblem, firstMatchingRule, matchesRule, planRuleUpdate } from './classification.utils'

/** Fields of a rule a client sends when creating or editing it. */
export interface RuleInput {
  scope: RuleScope
  source?: string | null | undefined
  name: string
  conditions: RuleCondition[]
  result_account_title_id?: string | null | undefined
  result_partner_id?: string | null | undefined
}

/** Lists a scope's rules in the order they are tried. */
export function listRules(db: DatabaseSync, companyId: string, scope: RuleScope, includeHidden: boolean): Rule[] {
  return serializeRules(db, companyId, listRuleRows(db, companyId, scope, includeHidden))
}

/** Creates a rule at the bottom of its scope's priority list. */
export function createRule(deps: ServiceDeps, companyId: string, input: RuleInput): Rule {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const row: RuleRow = {
      id: randomUUID(),
      company_id: companyId,
      scope: input.scope,
      source: input.source ?? null,
      name: input.name,
      conditions: JSON.stringify(input.conditions),
      result_account_title_id: input.result_account_title_id ?? null,
      result_partner_id: input.result_partner_id ?? null,
      priority: nextPriority(deps.db, companyId, input.scope),
      is_hidden: 0,
      created_at: now,
      updated_at: now,
    }
    validateRule(deps.db, row)
    insertRuleRow(deps.db, row)
    return requireRule(deps.db, companyId, row.id)
  })
}

/** Edits, hides or unhides a rule. The scope never changes. */
export function updateRule(
  deps: ServiceDeps,
  companyId: string,
  id: string,
  patch: Partial<Omit<RuleInput, 'scope'>> & { is_hidden?: boolean | undefined },
): Rule {
  return transaction(deps.db, () => {
    const current = findRuleRow(deps.db, companyId, id)
    if (current === undefined) throw notFound('Rule')
    const row: RuleRow = {
      ...current,
      source: patch.source === undefined ? current.source : patch.source,
      name: patch.name ?? current.name,
      conditions: patch.conditions === undefined ? current.conditions : JSON.stringify(patch.conditions),
      result_account_title_id: patch.result_account_title_id === undefined ? current.result_account_title_id : patch.result_account_title_id,
      result_partner_id: patch.result_partner_id === undefined ? current.result_partner_id : patch.result_partner_id,
      is_hidden: patch.is_hidden === undefined ? current.is_hidden : patch.is_hidden ? 1 : 0,
      updated_at: deps.clock.now(),
    }
    validateRule(deps.db, row)
    updateRuleRow(deps.db, row)
    return requireRule(deps.db, companyId, id)
  })
}

/** Deletes a rule. Rows it classified keep their account title. */
export function deleteRule(deps: ServiceDeps, companyId: string, id: string): void {
  if (deleteRuleRow(deps.db, companyId, id) === 0) throw notFound('Rule')
}

/**
 * Reorders a scope's rules so the first ID is tried first.
 *
 * @throws {DomainError} `VALIDATION_FAILED` unless `ids` lists every rule of the scope exactly once.
 */
export function reorderRules(deps: ServiceDeps, companyId: string, scope: RuleScope, ids: readonly string[]): Rule[] {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const existing = listRuleRows(deps.db, companyId, scope, true).map((row) => row.id)
    if (ids.length !== existing.length || new Set(ids).size !== ids.length || !ids.every((id) => existing.includes(id))) {
      throw invalidField('ids', 'List every rule of the scope exactly once.')
    }
    ids.forEach((id, index) => setRulePriority(deps.db, companyId, id, index + 1, now))
    return listRules(deps.db, companyId, scope, true)
  })
}

/**
 * Lists the rows an unsaved rule would match, for the live preview next to the rule form.
 *
 * @returns Matching row IDs for the requested page and the total match count.
 */
export function previewRule(
  db: DatabaseSync,
  companyId: string,
  scope: RuleScope,
  source: string | null,
  conditions: RuleCondition[],
  page: PageRequest,
): { ids: string[]; count: number } {
  const problem = conditionProblem(scope, conditions)
  if (problem !== null) throw invalidField('conditions', problem)
  const matches = loadClassifiableRows(db, companyId, scope).filter((row) => matchesRule({ source, conditions }, row.facts))
  return { ids: matches.slice(page.offset, page.offset + page.limit).map((row) => row.id), count: matches.length }
}

/**
 * Applies rules to a scope's existing rows and records the run as a job.
 *
 * Runs synchronously and returns the finished job; the job row keeps the
 * `202 {job_id}` contract so a background worker can take over later.
 *
 * @param ruleId Applies only this rule instead of every visible rule in priority order.
 */
export function applyRules(deps: ServiceDeps, companyId: string, scope: RuleScope, mode: ApplyMode, ruleId?: string): RuleApplyJob {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    let rules = activeRules(deps.db, companyId, scope)
    if (ruleId !== undefined) {
      const rule = findRuleRow(deps.db, companyId, ruleId)
      if (rule === undefined || rule.scope !== scope) throw invalidField('rule_id', 'Unknown rule for this scope.')
      rules = [compileRule(rule)]
    }
    const rows = loadClassifiableRows(deps.db, companyId, scope)
    const updated = classifyRows(deps.db, companyId, scope, rows, rules, mode)
    const job: RuleApplyJob = {
      id: randomUUID(),
      company_id: companyId,
      scope,
      rule_id: ruleId ?? null,
      mode,
      status: 'done',
      total: rows.length,
      processed: rows.length,
      updated,
      created_at: now,
      finished_at: now,
    }
    insertApplyJob(deps.db, job)
    return job
  })
}

/** Returns a rule application job's progress. */
export function getApplyJob(db: DatabaseSync, companyId: string, jobId: string): RuleApplyJob {
  const job = findApplyJob(db, companyId, jobId)
  if (job === undefined) throw notFound('Job')
  return job
}

/**
 * Classifies freshly collected rows with the first matching visible rule, filling only empty values.
 *
 * Call inside the transaction that inserted the rows.
 *
 * @returns How many rows changed.
 */
export function classifyNewRows(db: DatabaseSync, companyId: string, scope: RuleScope, ids: readonly string[]): number {
  if (ids.length === 0) return 0
  return classifyRows(db, companyId, scope, loadClassifiableRows(db, companyId, scope, ids), activeRules(db, companyId, scope), 'fill_empty')
}

function classifyRows(
  db: DatabaseSync,
  companyId: string,
  scope: RuleScope,
  rows: readonly ClassifiableRow[],
  rules: readonly CompiledRule[],
  mode: ApplyMode,
): number {
  if (rules.length === 0) return 0
  const titles = loadAccountTitleIndex(db, companyId)
  const changed: string[] = []
  for (const row of rows) {
    const matched = firstMatchingRule(rules, row.facts)
    if (matched === undefined) continue
    const direction = row.facts.direction as AccountScope | null
    const fitsDirection =
      scope !== 'bank' || matched.resultAccountTitleId === null || (direction !== null && titles.get(matched.resultAccountTitleId)?.applies_to.includes(direction) === true)
    const rule = fitsDirection ? matched : { ...matched, resultAccountTitleId: null }
    const plan = planRuleUpdate(row, rule, mode)
    if (plan === null) continue
    writeRuleClassification(db, companyId, scope, row.id, rule.id, plan)
    changed.push(row.id)
  }
  if (scope === 'bank') refreshSettlementStatuses(db, companyId, titles, changed)
  return changed.length
}

function activeRules(db: DatabaseSync, companyId: string, scope: RuleScope): CompiledRule[] {
  return listRuleRows(db, companyId, scope, false).map(compileRule)
}

function validateRule(db: DatabaseSync, row: RuleRow): void {
  const problem = conditionProblem(row.scope, JSON.parse(row.conditions) as RuleCondition[])
  if (problem !== null) throw invalidField('conditions', problem)
  if (row.result_account_title_id === null && row.result_partner_id === null) {
    throw invalidField('result_account_title_id', 'Choose an account title or a partner to apply.')
  }
  if (row.result_account_title_id !== null) {
    const info = loadAccountTitleIndex(db, row.company_id).get(row.result_account_title_id)
    const scope: AccountScope = row.scope === 'bank' ? (info?.applies_to.includes('deposit') === true ? 'deposit' : 'withdrawal') : row.scope
    assertAssignable(db, row.company_id, row.result_account_title_id, scope)
  }
  if (row.result_partner_id !== null) {
    const partner = queryAll<{ id: string }>(db, 'SELECT id FROM partners WHERE company_id = ? AND id = ? AND deleted_at IS NULL', [
      row.company_id,
      row.result_partner_id,
    ])
    if (partner.length === 0) throw invalidField('result_partner_id', 'Unknown partner.')
  }
}

function requireRule(db: DatabaseSync, companyId: string, id: string): Rule {
  const row = findRuleRow(db, companyId, id)
  if (row === undefined) throw notFound('Rule')
  const [rule] = serializeRules(db, companyId, [row])
  if (rule === undefined) throw notFound('Rule')
  return rule
}

function serializeRules(db: DatabaseSync, companyId: string, rows: readonly RuleRow[]): Rule[] {
  const titles = loadAccountTitleIndex(db, companyId)
  const partners = new Map(
    queryAll<{ id: string; name: string }>(db, 'SELECT id, name FROM partners WHERE company_id = ?', [companyId]).map((row) => [row.id, row.name]),
  )
  return rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    source: row.source,
    name: row.name,
    conditions: JSON.parse(row.conditions) as RuleCondition[],
    result_account_title_id: row.result_account_title_id,
    result_account_title_name: row.result_account_title_id === null ? null : (titles.get(row.result_account_title_id)?.name ?? null),
    result_partner_id: row.result_partner_id,
    result_partner_name: row.result_partner_id === null ? null : (partners.get(row.result_partner_id) ?? null),
    priority: row.priority,
    is_hidden: row.is_hidden === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
}
