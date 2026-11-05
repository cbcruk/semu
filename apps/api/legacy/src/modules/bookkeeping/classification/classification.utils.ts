import type {
  ApplyMode,
  ClassifiableRow,
  CompiledRule,
  RuleCondition,
  RuleFacts,
  RuleField,
  RuleOperator,
  RuleRow,
  RuleScope,
  RuleUpdate,
} from './classification.types'

/**
 * Whether `overwrite` leaves manually classified rows alone.
 *
 * The spec leaves this open; keeping manual choices avoids silently undoing a user's correction.
 */
export const OVERWRITE_KEEPS_MANUAL = true

const AMOUNT_OPERATORS: readonly RuleOperator[] = ['gte', 'lte', 'between']

/** Fields and operators each rule scope accepts. */
export const SCOPE_FIELDS: Record<RuleScope, Partial<Record<RuleField, readonly RuleOperator[]>>> = {
  sales: evidenceFields(),
  purchase: evidenceFields(),
  bank: {
    summary: ['starts_with', 'contains', 'equals'],
    amount: AMOUNT_OPERATORS,
    account: ['in'],
    direction: ['equals'],
    partner: ['in'],
  },
}

/**
 * Checks conditions against {@linkcode SCOPE_FIELDS} and the operand each operator needs.
 *
 * @returns A message describing the first problem, or `null` when the conditions are valid.
 */
export function conditionProblem(scope: RuleScope, conditions: readonly RuleCondition[]): string | null {
  if (conditions.length === 0) return 'Add at least one condition.'
  for (const [index, condition] of conditions.entries()) {
    const operators = SCOPE_FIELDS[scope][condition.field]
    if (operators === undefined) return `Condition ${index + 1}: ${condition.field} is not available for ${scope} rules.`
    if (!operators.includes(condition.op)) return `Condition ${index + 1}: ${condition.field} does not support ${condition.op}.`
    if (AMOUNT_OPERATORS.includes(condition.op)) {
      const needsMin = condition.op !== 'lte'
      const needsMax = condition.op !== 'gte'
      if ((needsMin && condition.min === undefined) || (needsMax && condition.max === undefined)) {
        return `Condition ${index + 1}: ${condition.op} needs ${needsMin && needsMax ? 'min and max' : needsMin ? 'min' : 'max'}.`
      }
      if (condition.op === 'between' && (condition.min ?? 0) > (condition.max ?? 0)) return `Condition ${index + 1}: min must not exceed max.`
    } else if (condition.values === undefined || condition.values.length === 0) {
      return `Condition ${index + 1}: ${condition.op} needs at least one value.`
    }
  }
  return null
}

/** Parses a rule row's conditions for matching. */
export function compileRule(row: Pick<RuleRow, 'id' | 'source' | 'conditions' | 'result_account_title_id' | 'result_partner_id'>): CompiledRule {
  return {
    id: row.id,
    source: row.source,
    conditions: JSON.parse(row.conditions) as RuleCondition[],
    resultAccountTitleId: row.result_account_title_id,
    resultPartnerId: row.result_partner_id,
  }
}

/** Checks whether every condition of a rule matches a row. */
export function matchesRule(rule: Pick<CompiledRule, 'source' | 'conditions'>, facts: RuleFacts): boolean {
  if (rule.source !== null && rule.source !== facts.source) return false
  return rule.conditions.every((condition) => matchesCondition(condition, facts))
}

/** Returns the first rule, in priority order, that matches a row. */
export function firstMatchingRule(rules: readonly CompiledRule[], facts: RuleFacts): CompiledRule | undefined {
  return rules.find((rule) => matchesRule(rule, facts))
}

/**
 * Decides what a matching rule changes on a row.
 *
 * `fill_empty` only fills an empty account title or partner; `overwrite`
 * replaces both unless the row was classified by hand and
 * {@linkcode OVERWRITE_KEEPS_MANUAL} is on.
 *
 * @returns The values to write (absent keys stay as they are), or `null` when nothing changes.
 */
export function planRuleUpdate(row: ClassifiableRow, rule: CompiledRule, mode: ApplyMode): RuleUpdate | null {
  if (mode === 'overwrite' && OVERWRITE_KEEPS_MANUAL && row.classified_by === 'manual') return null
  const update: RuleUpdate = {}
  const account = rule.resultAccountTitleId
  if (account !== null && (mode === 'overwrite' || row.account_title_id === null) && (account !== row.account_title_id || row.classified_by !== 'rule')) {
    update.accountTitleId = account
  }
  const partner = rule.resultPartnerId
  if (partner !== null && (mode === 'overwrite' || row.partner_id === null) && partner !== row.partner_id) update.partnerId = partner
  return update.accountTitleId === undefined && update.partnerId === undefined ? null : update
}

function matchesCondition(condition: RuleCondition, facts: RuleFacts): boolean {
  const value = facts[condition.field]
  if (typeof value === 'number') {
    const amount = Math.abs(value)
    if (condition.op === 'gte') return amount >= (condition.min ?? 0)
    if (condition.op === 'lte') return amount <= (condition.max ?? 0)
    if (condition.op === 'between') return amount >= (condition.min ?? 0) && amount <= (condition.max ?? 0)
    return false
  }
  const values = condition.values ?? []
  if (value === null) return false
  const text = value.toLowerCase()
  switch (condition.op) {
    case 'in':
    case 'equals':
      return values.some((candidate) => candidate.toLowerCase() === text)
    case 'contains':
      return values.some((candidate) => text.includes(candidate.toLowerCase()))
    case 'starts_with':
      return values.some((candidate) => text.startsWith(candidate.toLowerCase()))
    default:
      return false
  }
}

function evidenceFields(): Partial<Record<RuleField, readonly RuleOperator[]>> {
  return {
    partner: ['in'],
    counterparty: ['contains', 'equals'],
    item: ['starts_with', 'contains', 'equals'],
    total_amount: AMOUNT_OPERATORS,
    supply_amount: AMOUNT_OPERATORS,
    vat_amount: AMOUNT_OPERATORS,
    source: ['in'],
  }
}
