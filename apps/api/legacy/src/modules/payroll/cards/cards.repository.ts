/**
 * Storage of payroll cards, rows, card items, payslips and the company-level payroll records.
 *
 * Other domains read payroll through the service functions, never these tables.
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { PayrollIncomeType, PayrollRowResult } from '../engine/engine.types'
import type { YearMonth } from '../engine/rate-table.types'
import type {
  CardGeneration,
  CardKind,
  CardRow,
  CardStatus,
  IntegrationRow,
  PayrollRowRecord,
  PayslipNotificationStatus,
  PayslipRow,
  RowInputData,
  RowOverrides,
  RowWrite,
} from './cards.types'

/** Columns written when a card is created. */
export interface CardInsert {
  generation: CardGeneration
  kind: CardKind
  parentCardId: number | null
  title: string
  attributionMonth: YearMonth
  paymentDate: PlainDate
  periodStart: PlainDate
  periodEnd: PlainDate
  createdBy: string | null
}

/** Filters of a card list. */
export interface CardFilter {
  generation: CardGeneration
  year?: number
  attributionMonth?: YearMonth
  statuses?: readonly CardStatus[]
}

/** Inserts a card and returns its ID. */
export function insertCard(db: DatabaseSync, companyId: string, card: CardInsert, now: string): number {
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO payroll_cards (company_id, generation, kind, parent_card_id, title, attribution_month, payment_date, period_start, period_end,
       created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      companyId,
      card.generation,
      card.kind,
      card.parentCardId,
      card.title,
      card.attributionMonth,
      card.paymentDate,
      card.periodStart,
      card.periodEnd,
      card.createdBy,
      now,
      now,
    ],
  )
  if (row === undefined) throw new Error('Card insert returned no row.')
  return row.id
}

/** Finds a card of a company. */
export function findCard(db: DatabaseSync, companyId: string, cardId: number): CardRow | undefined {
  return queryOne<CardRow>(db, 'SELECT * FROM payroll_cards WHERE company_id = ? AND id = ?', [companyId, cardId])
}

/** Lists cards matching a filter, newest attribution month first. */
export function listCards(db: DatabaseSync, companyId: string, filter: CardFilter): CardRow[] {
  const clauses = ['company_id = ?', 'generation = ?']
  const params: SqlValue[] = [companyId, filter.generation]
  if (filter.year !== undefined) {
    clauses.push('substr(attribution_month, 1, 4) = ?')
    params.push(String(filter.year))
  }
  if (filter.attributionMonth !== undefined) {
    clauses.push('attribution_month = ?')
    params.push(filter.attributionMonth)
  }
  if (filter.statuses !== undefined && filter.statuses.length > 0) {
    clauses.push(`status IN (${placeholders(filter.statuses.length)})`)
    params.push(...filter.statuses)
  }
  return queryAll<CardRow>(db, `SELECT * FROM payroll_cards WHERE ${clauses.join(' AND ')} ORDER BY attribution_month DESC, kind, id`, params)
}

/** Lists every card of a company, of both generations, whose payment date falls within a period. */
export function listCardsPaidBetween(db: DatabaseSync, companyId: string, from: PlainDate, to: PlainDate): CardRow[] {
  return queryAll<CardRow>(db, 'SELECT * FROM payroll_cards WHERE company_id = ? AND payment_date BETWEEN ? AND ? ORDER BY id', [companyId, from, to])
}

/** Lists the cards of both generations whose attribution month falls in a year. */
export function listCardsOfYear(db: DatabaseSync, companyId: string, year: number, statuses: readonly CardStatus[]): CardRow[] {
  return queryAll<CardRow>(
    db,
    `SELECT * FROM payroll_cards WHERE company_id = ? AND substr(attribution_month, 1, 4) = ? AND status IN (${placeholders(statuses.length)}) ORDER BY id`,
    [companyId, String(year), ...statuses],
  )
}

/** Counts a company's cards of one generation in a status. */
export function countCardsInStatus(db: DatabaseSync, companyId: string, generation: CardGeneration, status: CardStatus): number {
  return (
    queryOne<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM payroll_cards WHERE company_id = ? AND generation = ? AND status = ?', [
      companyId,
      generation,
      status,
    ])?.n ?? 0
  )
}

/** Updates a card's title and payment date. */
export function updateCardHeader(db: DatabaseSync, companyId: string, cardId: number, title: string, paymentDate: PlainDate, now: string): void {
  execute(db, 'UPDATE payroll_cards SET title = ?, payment_date = ?, updated_at = ? WHERE company_id = ? AND id = ?', [
    title,
    paymentDate,
    now,
    companyId,
    cardId,
  ])
}

/**
 * Moves a card to a new status when it is still in an allowed state and at the expected version.
 *
 * @returns Whether the row changed; zero means a stale version or a concurrent transition.
 */
export function transitionCard(
  db: DatabaseSync,
  card: CardRow,
  from: readonly CardStatus[],
  to: CardStatus,
  expectedVersion: number,
  stamps: Partial<Pick<CardRow, 'approval_requested_at' | 'approval_requested_by' | 'approved_at' | 'approved_by' | 'rejected_at' | 'rejected_by' | 'payslips_sent_at' | 'exported_at' | 'export_type' | 'export_reference'>>,
  now: string,
): boolean {
  const columns = Object.keys(stamps) as (keyof typeof stamps)[]
  const assignments = columns.map((column) => `${column} = ?`)
  return (
    execute(
      db,
      `UPDATE payroll_cards SET ${['status = ?', ...assignments, 'version = version + 1', 'updated_at = ?'].join(', ')}
       WHERE company_id = ? AND id = ? AND version = ? AND status IN (${placeholders(from.length)})`,
      [to, ...columns.map((column) => stamps[column] ?? null), now, card.company_id, card.id, expectedVersion, ...from],
    ) > 0
  )
}

/** Sets a card's status directly; used by the seed and by rules that already hold the row. */
export function forceCardStatus(db: DatabaseSync, companyId: string, cardId: number, status: CardStatus, now: string): void {
  execute(db, 'UPDATE payroll_cards SET status = ?, version = version + 1, updated_at = ? WHERE company_id = ? AND id = ?', [
    status,
    now,
    companyId,
    cardId,
  ])
}

/** Deletes a card; rows, items and payslips cascade. */
export function deleteCard(db: DatabaseSync, companyId: string, cardId: number): boolean {
  return execute(db, 'DELETE FROM payroll_cards WHERE company_id = ? AND id = ?', [companyId, cardId]) > 0
}

/** Inserts a row and returns its ID. */
export function insertRow(db: DatabaseSync, companyId: string, cardId: number, row: RowWrite, now: string): number {
  const inserted = queryOne<{ id: number }>(
    db,
    `INSERT INTO payroll_rows (company_id, card_id, income_type, employee_id, name, registration_number_enc, is_foreigner, residence_country,
       payment_date, birth_date, department_name, email, employment_status_label, input, snapshot, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      companyId,
      cardId,
      row.income_type,
      row.employee_id,
      row.name,
      row.registration_number_enc,
      row.is_foreigner,
      row.residence_country,
      row.payment_date,
      row.birth_date,
      row.department_name,
      row.email,
      row.employment_status_label,
      JSON.stringify(row.input),
      JSON.stringify(row.snapshot),
      now,
      now,
    ],
  )
  if (inserted === undefined) throw new Error('Row insert returned no row.')
  return inserted.id
}

/** Lists a card's rows, optionally of some income types, in insertion order. */
export function listRows(db: DatabaseSync, companyId: string, cardId: number, incomeTypes?: readonly PayrollIncomeType[]): PayrollRowRecord[] {
  const filter = incomeTypes === undefined ? '' : ` AND income_type IN (${placeholders(incomeTypes.length)})`
  return queryAll<PayrollRowRecord>(
    db,
    `SELECT * FROM payroll_rows WHERE company_id = ? AND card_id = ?${filter} ORDER BY id`,
    [companyId, cardId, ...(incomeTypes ?? [])],
  )
}

/** Lists the rows of several cards. */
export function listRowsOfCards(db: DatabaseSync, companyId: string, cardIds: readonly number[]): PayrollRowRecord[] {
  if (cardIds.length === 0) return []
  return queryAll<PayrollRowRecord>(
    db,
    `SELECT * FROM payroll_rows WHERE company_id = ? AND card_id IN (${placeholders(cardIds.length)}) ORDER BY card_id, id`,
    [companyId, ...cardIds],
  )
}

/** Lists an employee's calculated wage rows of an attribution month across cards in some statuses. */
export function listEmployeeWageRowsOfMonth(
  db: DatabaseSync,
  companyId: string,
  employeeId: number,
  month: YearMonth,
  statuses: readonly CardStatus[],
): PayrollRowRecord[] {
  return queryAll<PayrollRowRecord>(
    db,
    `SELECT r.* FROM payroll_rows r JOIN payroll_cards c ON c.id = r.card_id
     WHERE r.company_id = ? AND r.employee_id = ? AND c.attribution_month = ? AND r.income_type LIKE 'wage_%'
       AND r.calculated_at IS NOT NULL AND c.status IN (${placeholders(statuses.length)})
     ORDER BY r.id`,
    [companyId, employeeId, month, ...statuses],
  )
}

/** Finds a row of a card. */
export function findRow(db: DatabaseSync, companyId: string, cardId: number, rowId: number): PayrollRowRecord | undefined {
  return queryOne<PayrollRowRecord>(db, 'SELECT * FROM payroll_rows WHERE company_id = ? AND card_id = ? AND id = ?', [companyId, cardId, rowId])
}

/** Replaces a row's input, invalidating its calculation. */
export function updateRowInput(db: DatabaseSync, companyId: string, rowId: number, input: RowInputData, now: string): void {
  execute(db, 'UPDATE payroll_rows SET input = ?, calculated_at = NULL, updated_at = ? WHERE company_id = ? AND id = ?', [
    JSON.stringify(input),
    now,
    companyId,
    rowId,
  ])
}

/** Columns of a row's personal data that callers may change. */
export type RowPersonalPatch = Partial<
  Pick<PayrollRowRecord, 'name' | 'registration_number_enc' | 'is_foreigner' | 'residence_country' | 'payment_date' | 'birth_date' | 'department_name' | 'email' | 'employment_status_label' | 'income_type'>
>

/** Updates a row's personal columns, invalidating its calculation. */
export function updateRowPersonal(db: DatabaseSync, companyId: string, rowId: number, patch: RowPersonalPatch, now: string): void {
  const columns = Object.keys(patch) as (keyof RowPersonalPatch)[]
  if (columns.length === 0) return
  execute(
    db,
    `UPDATE payroll_rows SET ${[...columns.map((column) => `${column} = ?`), 'calculated_at = NULL', 'updated_at = ?'].join(', ')}
     WHERE company_id = ? AND id = ?`,
    [...columns.map((column) => patch[column] ?? null), now, companyId, rowId],
  )
}

/** Replaces a row's HR snapshot. */
export function updateRowSnapshot(db: DatabaseSync, companyId: string, rowId: number, snapshot: object, now: string): void {
  execute(db, 'UPDATE payroll_rows SET snapshot = ?, calculated_at = NULL, updated_at = ? WHERE company_id = ? AND id = ?', [
    JSON.stringify(snapshot),
    now,
    companyId,
    rowId,
  ])
}

/** Replaces a row's manual overrides. */
export function updateRowOverrides(db: DatabaseSync, companyId: string, rowId: number, overrides: RowOverrides, now: string): void {
  execute(db, 'UPDATE payroll_rows SET overrides = ?, updated_at = ? WHERE company_id = ? AND id = ?', [JSON.stringify(overrides), now, companyId, rowId])
}

/** Stores a row's calculation result and its summary columns. */
export function saveRowResult(db: DatabaseSync, companyId: string, rowId: number, result: PayrollRowResult, now: string): void {
  execute(
    db,
    `UPDATE payroll_rows SET result = ?, gross_pay = ?, taxable_pay = ?, non_taxable_pay = ?, income_tax = ?, local_income_tax = ?,
       employee_insurance_total = ?, employer_insurance_total = ?, deduction_total = ?, net_pay = ?, calculated_at = ?, updated_at = ?
     WHERE company_id = ? AND id = ?`,
    [
      JSON.stringify(result),
      result.grossPay,
      result.taxablePay,
      result.nonTaxablePay,
      result.incomeTax,
      result.localIncomeTax,
      result.insurance.employee.total,
      result.employerInsuranceTotal,
      result.deductionTotal,
      result.netPay,
      now,
      now,
      companyId,
      rowId,
    ],
  )
}

/** Deletes rows of a card by ID, returning how many were removed. */
export function deleteRows(db: DatabaseSync, companyId: string, cardId: number, rowIds: readonly number[]): number {
  if (rowIds.length === 0) return 0
  return execute(db, `DELETE FROM payroll_rows WHERE company_id = ? AND card_id = ? AND id IN (${placeholders(rowIds.length)})`, [
    companyId,
    cardId,
    ...rowIds,
  ])
}

/** Lists the enabled flags a card stores for its payment or deduction items. */
export function listCardItemFlags(db: DatabaseSync, cardId: number, kind: 'payment' | 'deduction'): Map<number, boolean> {
  const rows = queryAll<{ item_id: number; is_enabled: 0 | 1 }>(db, 'SELECT item_id, is_enabled FROM payroll_card_items WHERE card_id = ? AND item_kind = ?', [
    cardId,
    kind,
  ])
  return new Map(rows.map((row) => [row.item_id, row.is_enabled === 1]))
}

/** Stores whether a card uses a payment or deduction item this month. */
export function setCardItemFlag(db: DatabaseSync, cardId: number, kind: 'payment' | 'deduction', itemId: number, enabled: boolean, now: string): void {
  execute(
    db,
    `INSERT INTO payroll_card_items (card_id, item_kind, item_id, is_enabled, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (card_id, item_kind, item_id) DO UPDATE SET is_enabled = excluded.is_enabled, updated_at = excluded.updated_at`,
    [cardId, kind, itemId, enabled ? 1 : 0, now],
  )
}

/** Lists the payslip records of a card. */
export function listPayslips(db: DatabaseSync, cardId: number): Map<number, PayslipRow> {
  return new Map(queryAll<PayslipRow>(db, 'SELECT * FROM payroll_payslips WHERE card_id = ?', [cardId]).map((row) => [row.row_id, row]))
}

/** Saves a row's payslip email and payment formulas, keeping fields passed as `undefined`. */
export function upsertPayslip(
  db: DatabaseSync,
  cardId: number,
  rowId: number,
  values: { email?: string | null; paymentFormulas?: Record<string, string> },
  now: string,
): void {
  execute(db, 'INSERT INTO payroll_payslips (row_id, card_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (row_id) DO NOTHING', [rowId, cardId, now])
  if (values.email !== undefined) execute(db, 'UPDATE payroll_payslips SET email = ?, updated_at = ? WHERE row_id = ?', [values.email, now, rowId])
  if (values.paymentFormulas !== undefined) {
    execute(db, 'UPDATE payroll_payslips SET payment_formulas = ?, updated_at = ? WHERE row_id = ?', [JSON.stringify(values.paymentFormulas), now, rowId])
  }
}

/** Sets a row's payslip delivery status. */
export function setPayslipStatus(
  db: DatabaseSync,
  cardId: number,
  rowId: number,
  status: PayslipNotificationStatus,
  failReason: string | null,
  now: string,
): void {
  execute(db, 'INSERT INTO payroll_payslips (row_id, card_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (row_id) DO NOTHING', [rowId, cardId, now])
  execute(
    db,
    `UPDATE payroll_payslips SET notification_status = ?, fail_reason = ?, sent_at = CASE WHEN ? = 'success' THEN ? ELSE sent_at END, updated_at = ?
     WHERE row_id = ?`,
    [status, failReason, status, now, now, rowId],
  )
}

/** Records a payslip delivery attempt and returns its ID. */
export function insertNotification(db: DatabaseSync, cardId: number, rowId: number, recipient: string | null, requestedBy: string, now: string): number {
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO payroll_payslip_notifications (row_id, card_id, recipient, status, requested_by, created_at)
     VALUES (?, ?, ?, 'in_flight', ?, ?) RETURNING id`,
    [rowId, cardId, recipient, requestedBy, now],
  )
  if (row === undefined) throw new Error('Notification insert returned no row.')
  return row.id
}

/** Completes a payslip delivery attempt. */
export function completeNotification(db: DatabaseSync, id: number, status: 'success' | 'fail', messageId: string | null, error: string | null, now: string): void {
  execute(db, 'UPDATE payroll_payslip_notifications SET status = ?, message_id = ?, error = ?, completed_at = ? WHERE id = ?', [
    status,
    messageId,
    error,
    now,
    id,
  ])
}

/** Finds a company's manager memo. */
export function findManagerMemo(db: DatabaseSync, companyId: string): { content: string; updated_by: string | null; updated_at: string } | undefined {
  return queryOne(db, 'SELECT content, updated_by, updated_at FROM payroll_manager_memos WHERE company_id = ?', [companyId])
}

/** Saves a company's manager memo. */
export function saveManagerMemo(db: DatabaseSync, companyId: string, content: string, userId: string, now: string): void {
  execute(
    db,
    `INSERT INTO payroll_manager_memos (company_id, content, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (company_id) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [companyId, content, userId, now],
  )
}

/** Finds whether a company chose to keep its legacy payroll settings. */
export function findMaintainPayroll(db: DatabaseSync, companyId: string): boolean {
  return queryOne<{ maintain_payroll: number }>(db, 'SELECT maintain_payroll FROM payroll_legacy_preferences WHERE company_id = ?', [companyId])?.maintain_payroll === 1
}

/** Records that a company keeps its legacy payroll settings. */
export function saveMaintainPayroll(db: DatabaseSync, companyId: string, userId: string, now: string): void {
  execute(
    db,
    `INSERT INTO payroll_legacy_preferences (company_id, maintain_payroll, updated_by, updated_at) VALUES (?, 1, ?, ?)
     ON CONFLICT (company_id) DO UPDATE SET maintain_payroll = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [companyId, userId, now],
  )
}

/** Finds a company's Shiftee integration. */
export function findIntegration(db: DatabaseSync, companyId: string): IntegrationRow | undefined {
  return queryOne<IntegrationRow>(db, "SELECT * FROM payroll_external_integrations WHERE company_id = ? AND provider = 'shiftee'", [companyId])
}

/** Stores a new Shiftee integration. */
export function insertIntegration(
  db: DatabaseSync,
  companyId: string,
  values: Pick<IntegrationRow, 'external_company_id' | 'company_name' | 'representative_name' | 'admin_email' | 'linked_by'>,
  now: string,
): void {
  execute(
    db,
    `INSERT INTO payroll_external_integrations (company_id, provider, status, external_company_id, company_name, representative_name, admin_email, linked_by, linked_at)
     VALUES (?, 'shiftee', 'linked', ?, ?, ?, ?, ?, ?)`,
    [companyId, values.external_company_id, values.company_name, values.representative_name, values.admin_email, values.linked_by, now],
  )
}

/** Marks a company's Shiftee integration as unlinked. */
export function unlinkIntegration(db: DatabaseSync, companyId: string, now: string): void {
  execute(db, "UPDATE payroll_external_integrations SET status = 'unlinked', unlinked_at = ? WHERE company_id = ? AND provider = 'shiftee'", [now, companyId])
}
