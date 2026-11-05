import type { GiroActionRow, GiroRow } from './giros.types'

/**
 * Converts every number in a bill detail to a string, the way the legacy API sends amounts.
 *
 * @example National tax detail
 * ```ts
 * import { stringifyAmounts } from './giros.utils'
 *
 * stringifyAmounts({ pay_amount: 100000, tax_name: '부가가치세' }) // { pay_amount: '100000', tax_name: '부가가치세' }
 * ```
 */
export function stringifyAmounts(detail: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(detail).map(([key, value]) => [key, typeof value === 'number' ? String(value) : value]))
}

/** Converts a bill and its latest action to the legacy `Giro` wire shape. */
export function serializeGiro(row: GiroRow, lastAction: GiroActionRow | undefined): Record<string, unknown> {
  return {
    id: row.id,
    company: row.company_id,
    created: row.created_at,
    modified: row.modified_at,
    memo: row.memo,
    status: row.status,
    done_reason: row.done_reason,
    status_updated_at: row.status_updated_at,
    last_action_history:
      lastAction === undefined
        ? null
        : {
            id: lastAction.id,
            created: lastAction.created_at,
            modified: lastAction.created_at,
            giro: row.id,
            status: lastAction.status,
            memo: lastAction.memo,
            username: lastAction.username,
            approver_username: lastAction.approver_username,
          },
    slip_type: row.slip_type,
    giro_type: row.giro_type,
    e_pay_no: row.e_pay_no,
    tax_name: row.tax_name,
    bill_org_name: row.bill_org_name,
    pay_amount: String(row.pay_amount),
    due_date: row.due_date,
    detail: stringifyAmounts(JSON.parse(row.detail) as Record<string, unknown>),
  }
}

/** Extracts the digits of an account number. */
export function accountDigits(value: string): string {
  return value.replace(/\D/g, '')
}
