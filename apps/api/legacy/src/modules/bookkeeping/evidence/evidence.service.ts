import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { assertAssignable, loadAccountTitleIndex } from '../account-titles/account-titles.service'
import type { AccountTitleInfo } from '../account-titles/account-titles.types'
import { requirePartner } from '../partners/partners.repository'
import { countEvidence, type EvidenceListRow, existingEvidenceIds, findEvidenceRow, listEvidenceRows, updateEvidenceManual } from './evidence.repository'
import type { ClassificationCounts, Evidence, EvidenceFilter, EvidencePatch, EvidenceSide, EvidenceSort } from './evidence.types'
import { evidenceAmounts } from './evidence.utils'

/** Lists evidence of one side with the classification tab counts. */
export function listEvidence(
  db: DatabaseSync,
  companyId: string,
  side: EvidenceSide,
  filter: EvidenceFilter,
  sort: EvidenceSort,
  page: { limit: number; offset: number },
): { rows: Evidence[]; count: number; counts: ClassificationCounts } {
  const titles = loadAccountTitleIndex(db, companyId)
  const { count, counts } = countEvidence(db, companyId, side, filter)
  return { rows: listEvidenceRows(db, companyId, side, filter, sort, page).map((row) => serializeEvidence(side, row, titles)), count, counts }
}

/** Lists every evidence record matching a filter, for export. */
export function exportEvidence(db: DatabaseSync, companyId: string, side: EvidenceSide, filter: EvidenceFilter, sort: EvidenceSort): Evidence[] {
  const titles = loadAccountTitleIndex(db, companyId)
  return listEvidenceRows(db, companyId, side, filter, sort, null).map((row) => serializeEvidence(side, row, titles))
}

/** Returns one evidence record with its item lines. */
export function getEvidence(db: DatabaseSync, companyId: string, side: EvidenceSide, id: string): Evidence & { items: unknown[] } {
  const row = findEvidenceRow(db, companyId, side, id)
  if (row === undefined) throw notFound('Evidence')
  const items: unknown = row.items === null ? [] : JSON.parse(row.items)
  return { ...serializeEvidence(side, row, loadAccountTitleIndex(db, companyId)), items: Array.isArray(items) ? items : [] }
}

/**
 * Classifies one evidence record by hand and sets its partner, memo or deductibility.
 *
 * Choosing an account title marks the record `manual` and drops the rule
 * reference; `null` returns it to unclassified. Deductibility only changes
 * when sent, so classification never moves the estimated VAT on its own.
 */
export function patchEvidence(deps: ServiceDeps, companyId: string, side: EvidenceSide, id: string, patch: EvidencePatch): Evidence {
  return transaction(deps.db, () => {
    if (findEvidenceRow(deps.db, companyId, side, id) === undefined) throw notFound('Evidence')
    if (patch.deductible !== undefined && side === 'sales') throw invalidField('deductible', 'Only purchase evidence has deductibility.')
    writeManual(deps.db, companyId, side, [id], patch)
    const row = findEvidenceRow(deps.db, companyId, side, id)
    if (row === undefined) throw notFound('Evidence')
    return serializeEvidence(side, row, loadAccountTitleIndex(deps.db, companyId))
  })
}

/** Classifies many evidence records at once. */
export function bulkClassifyEvidence(
  deps: ServiceDeps,
  companyId: string,
  side: EvidenceSide,
  input: { ids: string[]; account_title_id?: string | null | undefined; partner_id?: string | null | undefined },
): { updated: number } {
  return transaction(deps.db, () => {
    const ids = [...new Set(input.ids)]
    if (existingEvidenceIds(deps.db, companyId, side, ids).length !== ids.length) throw invalidField('ids', 'Some evidence does not exist.')
    return { updated: writeManual(deps.db, companyId, side, ids, { account_title_id: input.account_title_id, partner_id: input.partner_id }) }
  })
}

/** Converts an evidence row to its wire shape, deriving missing amounts. */
export function serializeEvidence(side: EvidenceSide, row: EvidenceListRow, titles: ReadonlyMap<string, AccountTitleInfo>): Evidence {
  const amounts = evidenceAmounts(row)
  return {
    id: row.id,
    side,
    source: row.source,
    doc_type: row.doc_type,
    kind: row.kind,
    written_on: row.written_on ?? row.issued_on,
    issued_on: row.issued_on,
    counterparty_name: row.counterparty_name,
    counterparty_business_number: row.counterparty_business_number,
    partner_id: row.partner_id,
    partner_name: row.partner_name,
    item_summary: row.item_summary,
    total_amount: amounts.total,
    supply_amount: amounts.supply,
    vat_amount: amounts.vat,
    account_title_id: row.account_title_id,
    account_title_name: row.account_title_id === null ? null : (titles.get(row.account_title_id)?.name ?? null),
    classified_by: row.classified_by,
    classified_rule_id: row.classified_rule_id,
    memo: row.memo,
    deductible: row.deductible === undefined || row.deductible === null ? null : row.deductible === 1,
    card_number_masked: row.card_number_masked,
    card_company_code: row.card_company_code,
    approval_no: row.approval_no,
    channel: row.channel ?? null,
    is_canceled: row.is_canceled === 1,
    dedupe_group: row.dedupe_group ?? null,
    sales_transaction_id: row.sales_transaction_id ?? null,
    synced_at: row.synced_at,
  }
}

function writeManual(db: DatabaseSync, companyId: string, side: EvidenceSide, ids: readonly string[], patch: EvidencePatch): number {
  if (patch.account_title_id !== undefined && patch.account_title_id !== null) assertAssignable(db, companyId, patch.account_title_id, side)
  if (patch.partner_id !== undefined && patch.partner_id !== null) requirePartner(db, companyId, patch.partner_id)
  return updateEvidenceManual(db, companyId, side, ids, {
    ...(patch.account_title_id === undefined ? {} : { accountTitleId: patch.account_title_id }),
    ...(patch.partner_id === undefined ? {} : { partnerId: patch.partner_id }),
    ...(patch.memo === undefined ? {} : { memo: patch.memo }),
    ...(patch.deductible === undefined ? {} : { deductible: patch.deductible === null ? null : patch.deductible ? 1 : 0 }),
  })
}
