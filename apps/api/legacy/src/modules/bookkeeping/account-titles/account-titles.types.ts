/** Screen an account title can be chosen on: sales or purchase evidence, or bank deposits or withdrawals. */
export type AccountScope = 'sales' | 'purchase' | 'deposit' | 'withdrawal'

/** Line of the profit and loss statement an account rolls up into; `none` keeps it out of P&L. */
export type PlCategory = 'revenue' | 'cogs' | 'sga' | 'non_op_income' | 'non_op_expense' | 'income_tax' | 'none'

/** A row of `account_titles`. */
export interface AccountTitleRow {
  id: string
  company_id: string | null
  parent_id: string | null
  depth: 1 | 2 | 3
  code: string | null
  name: string
  description: string | null
  applies_to: string
  pl_category: PlCategory
  cash_category: string | null
  is_system: 0 | 1
  is_auto_etc: 0 | 1
  sort_order: number
  deleted_at: string | null
  created_at: string
}

/** A node of the account title tree as returned to the client. */
export interface AccountTitleNode {
  id: string
  parent_id: string | null
  depth: 1 | 2 | 3
  code: string | null
  name: string
  description: string | null
  applies_to: AccountScope[]
  pl_category: PlCategory
  cash_category: string | null
  is_system: boolean
  is_auto_etc: boolean
  /** Whether transactions may be classified into this node: a depth 2 or 3 node without children. */
  is_selectable: boolean
  children: AccountTitleNode[]
}

/** What reports need to know about an account title, resolved through its ancestors. */
export interface AccountTitleInfo {
  id: string
  name: string
  depth: 1 | 2 | 3
  pl_category: PlCategory
  cash_category: string | null
  /** Name of the depth 2 ancestor (or the node itself), used as the report line name. */
  report_name: string
  /** Code of the depth 1 group, such as `trade` for 거래대금. */
  group_code: string | null
  applies_to: AccountScope[]
  is_selectable: boolean
}

/** Result of adding a company account title. */
export interface CreatedAccountTitle {
  account_title: AccountTitleNode
  /** The `기타 {상위명}` node created to keep transactions already classified into the parent, or `null`. */
  auto_created_etc: AccountTitleNode | null
  moved: number
}
