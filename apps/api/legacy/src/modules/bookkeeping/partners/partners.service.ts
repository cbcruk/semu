import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import type { AppDeps, ServiceDeps } from '../../../app.types'
import { execute, queryAll, queryOne, transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { maskTail } from '../../../lib/masking'
import { addDays, toPlainDate } from '../../../lib/plain-date'
import { loadAccountTitleIndex } from '../account-titles/account-titles.service'
import { type BankTransactionListRow, listBankTransactionRows } from '../bank/bank.repository'
import { serializeBankTransaction } from '../bank/bank.service'
import type { BankTransaction } from '../bank/bank.types'
import { EVIDENCE_TABLE, evidenceAmounts } from '../evidence/evidence.utils'
import type { EvidenceRow, EvidenceSide } from '../evidence/evidence.types'
import { createFakeBusinessStatusAdapter } from './business-status.adapter'
import {
  cacheBusinessStatus,
  findCachedBusinessStatus,
  findPartnerRow,
  lastTransactionTimes,
  linkEvidenceByBusinessNumber,
  listPartnerBankAccounts,
  listPartnerContacts,
  listPartnerRows,
  replacePartnerBankAccounts,
  replacePartnerContacts,
  savePartnerRow,
  unsettledAmounts,
} from './partners.repository'
import type { createPartnerBody, updatePartnerBody } from './partners.schema'
import type { BusinessStatusResult, PartnerBankAccountRow, PartnerContactRow, PartnerRow } from './partners.types'

/** Body of a partner registration after validation. */
export type CreatePartnerInput = z.infer<typeof createPartnerBody>

/** Body of a partner edit after validation. */
export type UpdatePartnerInput = z.infer<typeof updatePartnerBody>

const BUSINESS_STATUS_TTL_DAYS = 1

/** Lists partners with their realtime unsettled amounts. */
export function listPartners(
  deps: ServiceDeps,
  companyId: string,
  filter: { search?: string | undefined; kind?: 'sales' | 'purchase' | undefined },
  sort: string,
  page: { limit: number; offset: number },
): { rows: Record<string, unknown>[]; count: number } {
  const { rows, count } = listPartnerRows(deps.db, companyId, filter, sort, page)
  return { rows: serializePartners(deps, companyId, rows), count }
}

/** Returns one partner with its accounts, contacts and unsettled amounts. */
export function getPartner(deps: ServiceDeps, companyId: string, id: string): Record<string, unknown> {
  const row = findPartnerRow(deps.db, companyId, id)
  if (row === undefined) throw notFound('Partner')
  const [partner] = serializePartners(deps, companyId, [row])
  if (partner === undefined) throw notFound('Partner')
  return partner
}

/**
 * Registers a partner and links collected evidence that carries its business number.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when another partner has the same business number.
 */
export function createPartner(deps: ServiceDeps, companyId: string, input: CreatePartnerInput): Record<string, unknown> {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const id = randomUUID()
    const row: PartnerRow = {
      id,
      company_id: companyId,
      partner_type: input.partner_type,
      business_entity_type: input.business_entity_type ?? null,
      name: input.name,
      representative_name: input.representative_name,
      business_number: input.business_number ?? null,
      business_status: null,
      is_sales: input.sales ? 1 : 0,
      is_purchase: input.purchased ? 1 : 0,
      business_type: input.business_type ?? null,
      business_class: input.business_class ?? null,
      address: input.address ?? null,
      phone_number: input.phone_number ?? null,
      memo: input.memo ?? null,
      representative_image_path: input.representative_image_path ?? null,
      primary_account_id: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    assertUniqueBusinessNumber(deps.db, companyId, row.business_number, id)
    savePartnerRow(deps.db, row)
    writeChildren(deps, row, input.bank_accounts, input.contacts)
    if (row.business_number !== null) linkEvidenceByBusinessNumber(deps.db, companyId, id, row.business_number)
    return getPartner(deps, companyId, id)
  })
}

/** Edits a partner; sent account and contact lists replace the stored ones. */
export function updatePartner(deps: ServiceDeps, companyId: string, id: string, input: UpdatePartnerInput): Record<string, unknown> {
  return transaction(deps.db, () => {
    const current = findPartnerRow(deps.db, companyId, id)
    if (current === undefined) throw notFound('Partner')
    const row: PartnerRow = {
      ...current,
      partner_type: input.partner_type ?? current.partner_type,
      business_entity_type: input.business_entity_type === undefined ? current.business_entity_type : input.business_entity_type,
      name: input.name ?? current.name,
      representative_name: input.representative_name ?? current.representative_name,
      business_number: input.business_number === undefined ? current.business_number : input.business_number,
      is_sales: input.sales === undefined ? current.is_sales : input.sales ? 1 : 0,
      is_purchase: input.purchased === undefined ? current.is_purchase : input.purchased ? 1 : 0,
      business_type: input.business_type === undefined ? current.business_type : input.business_type,
      business_class: input.business_class === undefined ? current.business_class : input.business_class,
      address: input.address === undefined ? current.address : input.address,
      phone_number: input.phone_number === undefined ? current.phone_number : input.phone_number,
      memo: input.memo === undefined ? current.memo : input.memo,
      representative_image_path: input.representative_image_path === undefined ? current.representative_image_path : input.representative_image_path,
      updated_at: deps.clock.now(),
    }
    if (row.is_sales === 0 && row.is_purchase === 0) throw invalidField('sales', 'Choose 매출처, 매입처 or both.')
    if (row.partner_type === 'business' && row.business_number === null) throw invalidField('business_number', 'Business partners need a business number.')
    assertUniqueBusinessNumber(deps.db, companyId, row.business_number, id)
    savePartnerRow(deps.db, row)
    writeChildren(deps, row, input.bank_accounts, input.contacts)
    if (row.business_number !== null) linkEvidenceByBusinessNumber(deps.db, companyId, id, row.business_number)
    return getPartner(deps, companyId, id)
  })
}

/**
 * Deletes a partner softly and clears it from evidence, bank transactions and rules.
 *
 * Settlement links stay, so the bank side of past settlements is not lost.
 */
export function deletePartner(deps: ServiceDeps, companyId: string, id: string): void {
  transaction(deps.db, () => {
    if (findPartnerRow(deps.db, companyId, id) === undefined) throw notFound('Partner')
    for (const table of ['sales_evidence', 'purchase_evidence', 'bank_transactions']) {
      execute(deps.db, `UPDATE ${table} SET partner_id = NULL WHERE company_id = ? AND partner_id = ?`, [companyId, id])
    }
    execute(deps.db, 'DELETE FROM classification_rules WHERE company_id = ? AND result_partner_id = ? AND result_account_title_id IS NULL', [companyId, id])
    execute(deps.db, 'UPDATE classification_rules SET result_partner_id = NULL WHERE company_id = ? AND result_partner_id = ?', [companyId, id])
    execute(deps.db, 'UPDATE partners SET deleted_at = ? WHERE company_id = ? AND id = ?', [deps.clock.now(), companyId, id])
  })
}

/**
 * Lists a partner's evidence of one side with how much of each is settled (매출·매입 정산 이력).
 *
 * @param year Limits the list to evidence written in this year.
 */
export function listAdjustmentHistory(
  db: DatabaseSync,
  companyId: string,
  partnerId: string,
  side: EvidenceSide,
  year: number | undefined,
  page: { limit: number; offset: number },
): { rows: Record<string, unknown>[]; count: number; totals: { total_amount: number; settled_amount: number; remaining_amount: number } } {
  if (findPartnerRow(db, companyId, partnerId) === undefined) throw notFound('Partner')
  const table = EVIDENCE_TABLE[side]
  const yearFilter = year === undefined ? '' : "AND substr(COALESCE(e.written_on, e.issued_on), 1, 4) = ?"
  const params = year === undefined ? [companyId, partnerId] : [companyId, partnerId, String(year)]
  const rows = queryAll<EvidenceRow & { settled_amount: number }>(
    db,
    `SELECT e.*, COALESCE((SELECT SUM(l.amount) FROM settlement_links l WHERE l.company_id = e.company_id AND l.evidence_side = '${side}' AND l.evidence_id = e.id), 0) AS settled_amount
     FROM ${table} e WHERE e.company_id = ? AND e.partner_id = ? ${yearFilter}
     ORDER BY COALESCE(e.written_on, e.issued_on) DESC, e.id`,
    params,
  )
  const titles = loadAccountTitleIndex(db, companyId)
  const serialized = rows.map((row) => {
    const amounts = evidenceAmounts(row)
    return {
      id: row.id,
      source: row.source,
      written_on: row.written_on ?? row.issued_on,
      issued_on: row.issued_on,
      item_summary: row.item_summary,
      account_title_id: row.account_title_id,
      account_title_name: row.account_title_id === null ? null : (titles.get(row.account_title_id)?.name ?? null),
      total_amount: amounts.total,
      supply_amount: amounts.supply,
      vat_amount: amounts.vat,
      settled_amount: row.settled_amount,
      remaining_amount: amounts.total - row.settled_amount,
    }
  })
  const totals = serialized.reduce(
    (sum, row) => ({
      total_amount: sum.total_amount + row.total_amount,
      settled_amount: sum.settled_amount + row.settled_amount,
      remaining_amount: sum.remaining_amount + row.remaining_amount,
    }),
    { total_amount: 0, settled_amount: 0, remaining_amount: 0 },
  )
  return { rows: serialized.slice(page.offset, page.offset + page.limit), count: serialized.length, totals }
}

/** Lists the bank transactions classified to a partner (입출금 이력). */
export function listPartnerBankTransactions(
  db: DatabaseSync,
  companyId: string,
  partnerId: string,
  range: { start: string; end: string },
  page: { limit: number; offset: number },
): { rows: BankTransaction[]; count: number } {
  if (findPartnerRow(db, companyId, partnerId) === undefined) throw notFound('Partner')
  const filter = { ...range, direction: undefined, accountIds: [], accountTitleIds: [], classification: undefined, partnerId, search: undefined }
  const titles = loadAccountTitleIndex(db, companyId)
  const all: BankTransactionListRow[] = listBankTransactionRows(db, companyId, filter, '-transacted_at', null)
  return { rows: all.slice(page.offset, page.offset + page.limit).map((row) => serializeBankTransaction(row, titles)), count: all.length }
}

/** Looks up a business number's NTS status, caching answers for a day. */
export async function lookupBusinessStatus(deps: AppDeps, businessNumber: string): Promise<BusinessStatusResult> {
  const cached = findCachedBusinessStatus(deps.db, businessNumber)
  const today = deps.clock.today()
  if (cached !== undefined && addDays(toPlainDate(cached.checked_at.slice(0, 10)), BUSINESS_STATUS_TTL_DAYS) > today) {
    return { business_status: cached.business_status ?? 'unknown', taxation_type: cached.taxation_type, closed_on: cached.closed_on }
  }
  const status = await (deps.businessStatus ?? createFakeBusinessStatusAdapter()).lookup(businessNumber)
  const result: BusinessStatusResult = { business_status: status.businessStatus, taxation_type: status.taxationType, closed_on: status.closedOn }
  cacheBusinessStatus(deps.db, businessNumber, result, deps.clock.now())
  execute(deps.db, 'UPDATE partners SET business_status = ? WHERE business_number = ? AND deleted_at IS NULL', [result.business_status, businessNumber])
  return result
}

function serializePartners(deps: ServiceDeps, companyId: string, rows: readonly PartnerRow[]): Record<string, unknown>[] {
  const ids = rows.map((row) => row.id)
  const accounts = listPartnerBankAccounts(deps.db, ids)
  const contacts = listPartnerContacts(deps.db, ids)
  const unsettled = unsettledAmounts(deps.db, companyId, ids)
  const lastTimes = lastTransactionTimes(deps.db, companyId, ids)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    representative_name: row.representative_name,
    business_number: row.business_number,
    partner_type: row.partner_type,
    business_entity_type: row.business_entity_type,
    business_status: row.business_status,
    sales: row.is_sales === 1,
    purchased: row.is_purchase === 1,
    business_type: row.business_type,
    business_class: row.business_class,
    address: row.address,
    phone_number: row.phone_number,
    memo: row.memo,
    representative_image_path: row.representative_image_path,
    bank_accounts: accounts
      .filter((account) => account.partner_id === row.id)
      .map((account) => ({
        id: account.id,
        bank_code: account.bank_code,
        account_number: maskTail(deps.cipher.decrypt(account.account_number_enc), 4),
        account_name: account.account_name,
        bankbook_image_path: account.bankbook_image_path,
        is_primary: account.id === row.primary_account_id,
      })),
    contacts: contacts
      .filter((entry) => entry.partner_id === row.id)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        department: entry.department,
        email: entry.email,
        phone_number: entry.phone_number,
        mobile_number: entry.mobile_number,
        fax_number: entry.fax_number,
      })),
    primary_account_id: row.primary_account_id,
    ...(unsettled.get(row.id) ?? { unsettled_sales_amount: 0, unsettled_purchase_amount: 0 }),
    last_transaction_at: lastTimes.get(row.id) ?? null,
    created: row.created_at,
  }))
}

function writeChildren(deps: ServiceDeps, row: PartnerRow, bankAccounts: CreatePartnerInput['bank_accounts'], contacts: CreatePartnerInput['contacts']): void {
  if (bankAccounts !== undefined) {
    const existing = new Map(listPartnerBankAccounts(deps.db, [row.id]).map((account) => [account.id, account]))
    const accountRows: PartnerBankAccountRow[] = bankAccounts.map((account, index) => {
      const kept = account.id === undefined ? undefined : existing.get(account.id)
      if (account.account_number === undefined && kept === undefined) throw invalidField(`bank_accounts.${index}.account_number`, 'Enter the account number.')
      const digits = account.account_number?.replace(/\D/g, '')
      return {
        id: kept?.id ?? randomUUID(),
        partner_id: row.id,
        bank_code: account.bank_code,
        account_number_enc: digits === undefined ? (kept?.account_number_enc ?? '') : deps.cipher.encrypt(digits),
        account_number_tail: digits === undefined ? (kept?.account_number_tail ?? '') : digits.slice(-4),
        account_name: account.account_name ?? null,
        bankbook_image_path: account.bankbook_image_path ?? null,
        seq: index + 1,
      }
    })
    replacePartnerBankAccounts(deps.db, row.id, accountRows)
    const primaryIndex = bankAccounts.findIndex((account) => account.is_primary === true)
    const primary = accountRows[primaryIndex === -1 ? 0 : primaryIndex]?.id ?? null
    execute(deps.db, 'UPDATE partners SET primary_account_id = ? WHERE id = ?', [primary, row.id])
  }
  if (contacts !== undefined) {
    const contactRows: PartnerContactRow[] = contacts.map((entry, index) => ({
      id: randomUUID(),
      partner_id: row.id,
      name: entry.name,
      department: entry.department ?? null,
      email: entry.email ?? null,
      phone_number: entry.phone_number ?? null,
      mobile_number: entry.mobile_number ?? null,
      fax_number: entry.fax_number ?? null,
      seq: index + 1,
    }))
    replacePartnerContacts(deps.db, row.id, contactRows)
  }
}

function assertUniqueBusinessNumber(db: DatabaseSync, companyId: string, businessNumber: string | null, selfId: string): void {
  if (businessNumber === null) return
  const other = queryOne<{ id: string }>(db, 'SELECT id FROM partners WHERE company_id = ? AND business_number = ? AND deleted_at IS NULL AND id <> ?', [
    companyId,
    businessNumber,
    selfId,
  ])
  if (other !== undefined) throw invalidField('business_number', 'A partner with this business number already exists.')
}
