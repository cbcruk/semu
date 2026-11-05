import { randomUUID } from 'node:crypto'
import type { AppDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { toValidationError } from '../../../middleware/validation'
import type { CompanyRow } from '../../companies/companies.types'
import { createFakeHometaxInvoiceAdapter } from './hometax-invoice.adapter'
import {
  deleteTransaction,
  findInvoice,
  findTransaction,
  insertIssuingInvoice,
  insertTransaction,
  linkEvidenceToTransaction,
  listInvoices,
  listItems,
  markInvoiceFailed,
  markInvoiceIssued,
  markInvoiceSynced,
  partnerExists,
  updateTransaction,
} from './transaction-sales.repository'
import { createTransactionBody, type TransactionBody } from './transaction-sales.schema'
import type { HometaxInvoiceAdapter, IssuedInvoiceRow, SalesTransactionInput, SalesTransactionListRow, TransactionParty } from './transaction-sales.types'
import { itemSummary, PARTY_FIELDS, toIssuedInvoice, toItem, toSnapshot } from './transaction-sales.utils'

type Deps = Pick<AppDeps, 'db' | 'clock' | 'hometaxInvoice'>

/** Returns the injected Hometax adapter or the deterministic fake. */
export function hometaxAdapterOf(deps: Pick<AppDeps, 'hometaxInvoice'>): HometaxInvoiceAdapter {
  return deps.hometaxInvoice ?? createFakeHometaxInvoiceAdapter()
}

/** Serializes a statement for lists, with item summary and latest issue fields. */
export function serializeTransaction(deps: Pick<AppDeps, 'db'>, row: SalesTransactionListRow, withInvoices = false): Record<string, unknown> {
  const items = listItems(deps.db, row.id).map(toItem)
  const invoices = listInvoices(deps.db, row.id)
  const latestIssued = invoices.find((invoice) => invoice.status === 'issued')
  const body: Record<string, unknown> = {
    ...toSnapshot(row, items),
    item_summary: itemSummary(items),
    item_count: items.length,
    invoice_count: row.invoice_count,
    latest_issue_invoice_type: latestIssued?.issue_type ?? null,
    latest_issue_date: latestIssued?.issue_datetime?.slice(0, 10) ?? null,
    latest_issue_invoice: latestIssued === undefined ? null : toIssuedInvoice(latestIssued),
  }
  if (withInvoices) body['invoices'] = invoices.map(toIssuedInvoice)
  return body
}

/**
 * Creates a transaction statement, filling the supplier from the company when the body omits it.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when the amounts do not add up or the kind is unsupported.
 */
export function createTransaction(deps: Deps, company: CompanyRow, body: TransactionBody): SalesTransactionListRow {
  const input = toInput(deps, company, body)
  const id = randomUUID()
  return transaction(deps.db, () => {
    insertTransaction(deps.db, company.id, id, input, deps.clock.now())
    return requireTransaction(deps, company.id, id)
  })
}

/**
 * Updates a statement that has not been issued yet.
 *
 * @throws {DomainError} `INVALID_TRANSITION` once an invoice was issued, because amended invoices are not supported.
 */
export function patchTransaction(deps: Deps, company: CompanyRow, id: string, patch: Partial<TransactionBody>): SalesTransactionListRow {
  const current = requireTransaction(deps, company.id, id)
  assertDraft(current)
  const merged = { ...toBody(deps, current), ...stripUndefined(patch) }
  const parsed = createTransactionBody.safeParse(merged)
  if (!parsed.success) throw toValidationError(parsed.error.issues)
  const input = toInput(deps, company, parsed.data)
  return transaction(deps.db, () => {
    assertDraft(requireTransaction(deps, company.id, id))
    updateTransaction(deps.db, company.id, id, input, deps.clock.now())
    return requireTransaction(deps, company.id, id)
  })
}

/** Deletes a statement that has not been issued yet. */
export function removeTransaction(deps: Deps, companyId: string, id: string): void {
  transaction(deps.db, () => {
    assertDraft(requireTransaction(deps, companyId, id))
    deleteTransaction(deps.db, companyId, id, deps.clock.now())
  })
}

/**
 * Issues an electronic tax invoice for a statement through Hometax.
 *
 * The attempt is recorded as `issuing` before the adapter call and settled to
 * `issued` or `failed` afterwards, so a crash leaves a visible in-flight row.
 *
 * @throws {DomainError} `INVALID_TRANSITION` when already issued or issuing, `VALIDATION_FAILED` when Hometax rejects it.
 */
export async function publishInvoice(deps: Deps, companyId: string, id: string): Promise<Record<string, unknown>> {
  const invoiceId = randomUUID()
  const requestedAt = deps.clock.now()
  const snapshot = transaction(deps.db, () => {
    const current = requireTransaction(deps, companyId, id)
    assertDraft(current)
    if (listInvoices(deps.db, id).some((invoice) => invoice.status === 'issuing')) {
      throw new DomainError('INVALID_TRANSITION', 'An invoice for this statement is already being issued.')
    }
    const frozen = toSnapshot(current, listItems(deps.db, id).map(toItem))
    insertIssuingInvoice(deps.db, companyId, id, invoiceId, JSON.stringify(frozen), requestedAt)
    return frozen
  })
  let result: Awaited<ReturnType<HometaxInvoiceAdapter['publish']>>
  try {
    result = await hometaxAdapterOf(deps).publish({ companyId, transactionId: id, requestedAt, snapshot })
  } catch (error) {
    markInvoiceFailed(deps.db, invoiceId, 'ADAPTER_ERROR', 'Hometax did not respond.', deps.clock.now())
    throw error
  }
  if (!result.ok) {
    markInvoiceFailed(deps.db, invoiceId, result.error_code, result.error_message, deps.clock.now())
    throw new DomainError('VALIDATION_FAILED', result.error_message, { errors: { non_field_errors: [`${result.error_code}: ${result.error_message}`] } })
  }
  const issued = result
  return transaction(deps.db, () => {
    markInvoiceIssued(deps.db, invoiceId, issued.issue_no, issued.issue_datetime, deps.clock.now())
    linkEvidenceToTransaction(deps.db, companyId, id, issued.issue_no)
    return toIssuedInvoice(requireInvoice(deps, companyId, id, invoiceId))
  })
}

/**
 * Fetches an issued invoice's detail from Hometax and marks it synced.
 *
 * @throws {DomainError} `INVALID_TRANSITION` when the invoice was not issued.
 */
export async function syncInvoice(deps: Deps, companyId: string, id: string, invoiceId: string): Promise<Record<string, unknown>> {
  requireTransaction(deps, companyId, id)
  const invoice = requireInvoice(deps, companyId, id, invoiceId)
  if (invoice.status !== 'issued' || invoice.issue_no === null) {
    throw new DomainError('INVALID_TRANSITION', `The invoice is ${invoice.status} and cannot be synced.`)
  }
  const detail = await hometaxAdapterOf(deps).fetchDetail(companyId, invoice.issue_no)
  if (!detail.found) throw notFound('Hometax invoice')
  const issueNo = invoice.issue_no
  return transaction(deps.db, () => {
    markInvoiceSynced(deps.db, invoiceId, deps.clock.now())
    linkEvidenceToTransaction(deps.db, companyId, id, issueNo)
    return toIssuedInvoice(requireInvoice(deps, companyId, id, invoiceId))
  })
}

/** Finds a statement or throws `NOT_FOUND`. */
export function requireTransaction(deps: Pick<AppDeps, 'db'>, companyId: string, id: string): SalesTransactionListRow {
  const row = findTransaction(deps.db, companyId, id)
  if (row === undefined) throw notFound('Transaction')
  return row
}

function requireInvoice(deps: Pick<AppDeps, 'db'>, companyId: string, id: string, invoiceId: string): IssuedInvoiceRow {
  const row = findInvoice(deps.db, companyId, id, invoiceId)
  if (row === undefined) throw notFound('Invoice')
  return row
}

function assertDraft(row: SalesTransactionListRow): void {
  if (row.invoice_count > 0) throw new DomainError('INVALID_TRANSITION', 'An issued statement cannot be changed or deleted.')
}

function toInput(deps: Pick<AppDeps, 'db'>, company: CompanyRow, body: TransactionBody): SalesTransactionInput {
  if (body.kind_code === '03' || body.kind_code === '04') throw invalidField('kind_code', 'Delegated invoices are not supported.')
  if (body.class_code === '02' || body.class_code === '04') throw invalidField('class_code', 'Amended invoices are not supported.')
  if (body.partner_id !== undefined && body.partner_id !== null && !partnerExists(deps.db, company.id, body.partner_id)) {
    throw invalidField('partner_id', 'Unknown partner.')
  }
  const supply = body.items.reduce((sum, item) => sum + item.supply_amount, 0)
  const tax = body.items.reduce((sum, item) => sum + item.tax_amount, 0)
  if (supply !== body.charge_total_amount) throw invalidField('charge_total_amount', 'Must equal the sum of item supply amounts.')
  if (tax !== body.tax_total_amount) throw invalidField('tax_total_amount', 'Must equal the sum of item tax amounts.')
  if (body.grand_total_amount !== body.charge_total_amount + body.tax_total_amount) {
    throw invalidField('grand_total_amount', 'Must equal the supply total plus the tax total.')
  }
  if ((body.class_code === '03' || body.kind_code === '02') && body.tax_total_amount !== 0) {
    throw invalidField('tax_total_amount', 'Tax-exempt and zero-rated invoices carry no tax.')
  }
  const flat = body as unknown as Record<string, unknown>
  const party = (prefix: 'supplier' | 'buyer'): TransactionParty => {
    return Object.fromEntries(PARTY_FIELDS.map((field) => [field, (flat[`${prefix}_${field}`] as string | null | undefined) ?? null])) as unknown as TransactionParty
  }
  const supplier = party('supplier')
  supplier.business_number ??= company.business_number.replaceAll('-', '')
  supplier.company_name ??= company.name
  const buyer = party('buyer')
  buyer.email_sub = body.buyer_email_sub ?? null
  return {
    partner_id: body.partner_id ?? null,
    class_code: body.class_code,
    kind_code: body.kind_code,
    buyer_class_code: body.buyer_class_code,
    purpose: body.purpose,
    write_date: body.write_date,
    description: body.description ?? null,
    cash: body.cash ?? null,
    check_bill: body.check_bill ?? null,
    note: body.note ?? null,
    crit: body.crit ?? null,
    supplier,
    buyer,
    items: body.items.map((item) => ({
      month: item.month,
      day: item.day,
      name: item.name,
      specification: item.specification ?? null,
      quantity: item.quantity ?? null,
      unit_price: item.unit_price ?? null,
      supply_amount: item.supply_amount,
      tax_amount: item.tax_amount,
      description: item.description ?? null,
    })),
    grand_total_amount: body.grand_total_amount,
    charge_total_amount: body.charge_total_amount,
    tax_total_amount: body.tax_total_amount,
  }
}

function toBody(deps: Pick<AppDeps, 'db'>, row: SalesTransactionListRow): Record<string, unknown> {
  const snapshot = toSnapshot(row, listItems(deps.db, row.id).map(toItem))
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot)) if (value !== null) body[key] = value
  body['items'] = snapshot.items.map(({ id: _id, ...item }) => item)
  for (const key of ['id', 'company', 'created', 'modified']) delete body[key]
  return body
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}
