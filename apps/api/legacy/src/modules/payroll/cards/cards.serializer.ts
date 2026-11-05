import type { Cipher } from '../../../lib/crypto/crypto.types'
import { maskRegistrationNumber } from '../../../lib/masking'
import type { PayrollRowResult } from '../engine/engine.types'
import { serializeRowResult } from '../reference/simulate'
import { legacyStatusOf, stepOf } from './card-status'
import type { CardRow, PayrollRowRecord, PayslipRow, RowOverrides } from './cards.types'
import { legacySegmentOf, parseJsonColumn, segmentOf } from './cards.utils'

/** Serializes a card header with per-segment headcounts and totals computed from its rows. */
export function serializeCard(card: CardRow, rows: readonly PayrollRowRecord[], extras: Record<string, unknown> = {}): Record<string, unknown> {
  const headcount: Record<string, number> = { 'wage-monthly': 0, 'wage-daily': 0, 'wage-hourly': 0, daily: 0, business: 0, other: 0 }
  const totals: Record<string, { gross_pay: number; net_pay: number }> = {}
  for (const row of rows) {
    const segment = segmentOf(row.income_type)
    headcount[segment] = (headcount[segment] ?? 0) + 1
    const total = (totals[segment] ??= { gross_pay: 0, net_pay: 0 })
    total.gross_pay += row.gross_pay
    total.net_pay += row.net_pay
  }
  return {
    id: card.id,
    generation: card.generation,
    kind: card.kind,
    parent_card_id: card.parent_card_id,
    title: card.title,
    name: card.title,
    attribution_month: card.attribution_month,
    payment_date: card.payment_date,
    period_start: card.period_start,
    period_end: card.period_end,
    status: card.status,
    legacy_status: legacyStatusOf(card.status),
    step: stepOf(card.status),
    step_count: 3,
    version: card.version,
    approval_requested_at: card.approval_requested_at,
    approved_at: card.approved_at,
    rejected_at: card.rejected_at,
    payslips_sent_at: card.payslips_sent_at,
    exported_at: card.exported_at,
    export_type: card.export_type,
    headcount_by_type: headcount,
    total_by_type: totals,
    gross_total: rows.reduce((total, row) => total + row.gross_pay, 0),
    net_total: rows.reduce((total, row) => total + row.net_pay, 0),
    uncalculated_count: rows.filter((row) => row.calculated_at === null).length,
    created_at: card.created_at,
    updated_at: card.updated_at,
    ...extras,
  }
}

/**
 * Serializes a row with its input, overrides and the stored calculation.
 *
 * The registration number is decrypted only to be masked. Amounts of a row
 * whose input changed after its last calculation are reported with
 * `is_calculated: false`.
 */
export function serializeRow(row: PayrollRowRecord, cipher: Cipher, payslip?: PayslipRow): Record<string, unknown> {
  const result = parseJsonColumn<PayrollRowResult | null>(row.result, null)
  const overrides = parseJsonColumn<RowOverrides>(row.overrides, {})
  const calculation = result === null ? null : serializeRowResult(segmentOf(row.income_type), result)
  return {
    id: row.id,
    card_id: row.card_id,
    income_type: segmentOf(row.income_type),
    legacy_income_type: legacySegmentOf(row.income_type),
    employee_id: row.employee_id,
    name: row.name,
    resident_number: row.registration_number_enc === null ? null : maskRegistrationNumber(cipher.decrypt(row.registration_number_enc)),
    is_foreigner: row.is_foreigner === 1,
    residence_country: row.residence_country,
    payment_date: row.payment_date,
    birth_date: row.birth_date,
    department: row.department_name,
    email: payslip?.email ?? row.email,
    employment_status_label: row.employment_status_label,
    ...parseJsonColumn<Record<string, unknown>>(row.input, {}),
    overrides,
    is_manually_overridden: Object.keys(overrides).length > 0,
    is_calculated: row.calculated_at !== null,
    calculated_at: row.calculated_at,
    gross_pay: row.gross_pay,
    taxable_pay: row.taxable_pay,
    non_taxable_pay: row.non_taxable_pay,
    income_tax: row.income_tax,
    local_income_tax: row.local_income_tax,
    employee_insurance_total: row.employee_insurance_total,
    employer_insurance_total: row.employer_insurance_total,
    deduction_total: row.deduction_total,
    net_pay: row.net_pay,
    calculation,
  }
}
