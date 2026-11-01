/** Menu a rule belongs to: sales evidence, purchase evidence or bank transactions. */
export type RuleScope = 'sales' | 'purchase' | 'bank'

/** How "apply to previous transactions" treats rows that already have values. */
export type ApplyMode = 'fill_empty' | 'overwrite'

/** Field a rule condition looks at. Evidence rules use the first group, bank rules the second. */
export type RuleField =
  | 'partner'
  | 'counterparty'
  | 'item'
  | 'total_amount'
  | 'supply_amount'
  | 'vat_amount'
  | 'source'
  | 'summary'
  | 'amount'
  | 'account'
  | 'direction'

/** Comparison a rule condition makes. */
export type RuleOperator = 'in' | 'contains' | 'starts_with' | 'equals' | 'gte' | 'lte' | 'between'

/**
 * One condition of a rule; every condition of a rule must match.
 *
 * Text and set operators read `values` (any value may match); amount
 * operators read `min` and `max` in won, compared to the absolute amount.
 */
export interface RuleCondition {
  field: RuleField
  op: RuleOperator
  values?: string[] | undefined
  min?: number | undefined
  max?: number | undefined
}

/** A row of `classification_rules`. */
export interface RuleRow {
  id: string
  company_id: string
  scope: RuleScope
  source: string | null
  name: string
  conditions: string
  result_account_title_id: string | null
  result_partner_id: string | null
  priority: number
  is_hidden: 0 | 1
  created_at: string
  updated_at: string
}

/** A classification rule in wire shape. */
export interface Rule {
  id: string
  scope: RuleScope
  source: string | null
  name: string
  conditions: RuleCondition[]
  result_account_title_id: string | null
  result_account_title_name: string | null
  result_partner_id: string | null
  result_partner_name: string | null
  priority: number
  is_hidden: boolean
  created_at: string
  updated_at: string
}

/** A parsed rule ready for matching. */
export interface CompiledRule {
  id: string
  source: string | null
  conditions: RuleCondition[]
  resultAccountTitleId: string | null
  resultPartnerId: string | null
}

/** Values a rule condition can be evaluated against, gathered from an evidence or bank row. */
export interface RuleFacts {
  partner: string | null
  counterparty: string
  item: string
  total_amount: number
  supply_amount: number
  vat_amount: number
  source: string | null
  summary: string
  amount: number
  account: string | null
  direction: string | null
}

/** A row the rule engine can classify, with its current classification. */
export interface ClassifiableRow {
  id: string
  facts: RuleFacts
  account_title_id: string | null
  partner_id: string | null
  classified_by: 'manual' | 'rule' | null
}

/** Values a rule writes onto a row; absent keys stay unchanged. */
export interface RuleUpdate {
  accountTitleId?: string
  partnerId?: string
}

/** A row of `rule_apply_jobs`, which is also its wire shape. */
export interface RuleApplyJob {
  id: string
  company_id: string
  scope: RuleScope
  rule_id: string | null
  mode: ApplyMode
  status: 'queued' | 'running' | 'done' | 'failed'
  total: number
  processed: number
  updated: number
  created_at: string
  finished_at: string | null
}
