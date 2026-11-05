import type { PlainDate } from '../../lib/plain-date.types'
import type { MenuCode } from '../access/access.types'

/** Kinds of home cards generated from filings. */
export type ActionCardKind = 'submit_materials' | 'confirm_ledger' | 'review_filing_result' | 'pay_tax'

/** State of a home card; both closed states appear in the archived tab. */
export type ActionCardStatus = 'open' | 'done' | 'skipped_overdue'

/** Reason a user gives when closing a card. */
export type CompletionReason = 'done' | 'skip'

/** A row of the `action_cards` table. */
export interface ActionCardRow {
  id: string
  company_id: string
  source_type: string
  source_id: string
  kind: ActionCardKind
  menu_code: MenuCode
  title: string
  cta_path: string
  due_date: PlainDate | null
  status: ActionCardStatus
  reopen_count: number
  created_at: string
  completed_at: string | null
}

/** Data needed to open or reopen a card. */
export interface OpenCardInput {
  companyId: string
  sourceType: string
  sourceId: string
  kind: ActionCardKind
  menuCode: MenuCode
  title: string
  ctaPath: string
  dueDate: PlainDate | null
}

/** Counts for the summary endpoint. */
export interface ActionCardSummary {
  active_count: number
  archived_count: number
  nearest_due_date: PlainDate | null
}
