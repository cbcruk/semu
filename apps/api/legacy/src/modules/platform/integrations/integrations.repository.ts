import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne } from '../../../db/query'
import type { IntegrationType } from '../adapters/scraping.adapter'
import type { CertificateRow, IntegrationRow, ItemKind, ItemRow, ScrapRequestRow, ScrapResultRow } from './integrations.types'

/** Lists a company's live integrations, optionally of one type. */
export function listIntegrations(db: DatabaseSync, companyId: string, type?: IntegrationType): IntegrationRow[] {
  return type === undefined
    ? queryAll<IntegrationRow>(db, "SELECT * FROM integrations WHERE company_id = ? AND status <> 'deleted' ORDER BY created_at, id", [companyId])
    : queryAll<IntegrationRow>(db, "SELECT * FROM integrations WHERE company_id = ? AND type = ? AND status <> 'deleted' ORDER BY created_at, id", [
        companyId,
        type,
      ])
}

/** Finds a live integration within a company. */
export function findIntegration(db: DatabaseSync, companyId: string, integrationId: string): IntegrationRow | undefined {
  return queryOne<IntegrationRow>(db, "SELECT * FROM integrations WHERE company_id = ? AND id = ? AND status <> 'deleted'", [companyId, integrationId])
}

/** Inserts an integration with its encrypted credential. */
export function insertIntegration(db: DatabaseSync, row: IntegrationRow, ciphertext: string): void {
  execute(
    db,
    `INSERT INTO integrations (id, company_id, type, sub_code, auth_type, is_corporate, certificate_id, account_id, status, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.company_id, row.type, row.sub_code, row.auth_type, row.is_corporate, row.certificate_id, row.account_id, row.status, row.created_at, row.modified_at],
  )
  execute(db, "INSERT INTO integration_credentials (integration_id, ciphertext, key_version, created_at) VALUES (?, ?, 'v1', ?)", [
    row.id,
    ciphertext,
    row.created_at,
  ])
}

/** Replaces an integration's encrypted credential and account ID. */
export function replaceCredential(db: DatabaseSync, integrationId: string, accountId: string | null, ciphertext: string, now: string): void {
  execute(db, 'UPDATE integrations SET account_id = ?, modified_at = ? WHERE id = ?', [accountId, now, integrationId])
  execute(db, 'UPDATE integration_credentials SET ciphertext = ?, created_at = ? WHERE integration_id = ?', [ciphertext, now, integrationId])
}

/** Reads an integration's encrypted credential. */
export function findCredential(db: DatabaseSync, integrationId: string): string | undefined {
  return queryOne<{ ciphertext: string }>(db, 'SELECT ciphertext FROM integration_credentials WHERE integration_id = ?', [integrationId])?.ciphertext
}

/** Marks an integration deleted, destroys its credential and retires its items; scrap history is kept. */
export function deleteIntegration(db: DatabaseSync, integrationId: string, now: string): void {
  execute(db, "UPDATE integrations SET status = 'deleted', deleted_at = ?, modified_at = ? WHERE id = ?", [now, now, integrationId])
  execute(db, 'DELETE FROM integration_credentials WHERE integration_id = ?', [integrationId])
  execute(db, 'UPDATE integration_items SET deleted_at = ?, is_active = 0 WHERE integration_id = ? AND deleted_at IS NULL', [now, integrationId])
}

/** Sets an integration's status. */
export function setIntegrationStatus(db: DatabaseSync, integrationId: string, status: IntegrationRow['status'], now: string): void {
  execute(db, 'UPDATE integrations SET status = ?, modified_at = ? WHERE id = ?', [status, now, integrationId])
}

/** Lists the live items of an integration. */
export function listItems(db: DatabaseSync, integrationId: string): ItemRow[] {
  return queryAll<ItemRow>(db, 'SELECT * FROM integration_items WHERE integration_id = ? AND deleted_at IS NULL ORDER BY created_at, id', [integrationId])
}

/** Counts a company's live items of one kind under live integrations of a type. */
export function countCompanyItems(db: DatabaseSync, companyId: string, type: IntegrationType, kind: ItemKind): number {
  return (
    queryOne<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM integration_items i JOIN integrations g ON g.id = i.integration_id
       WHERE i.company_id = ? AND g.type = ? AND i.kind = ? AND i.deleted_at IS NULL AND g.status <> 'deleted'`,
      [companyId, type, kind],
    )?.n ?? 0
  )
}

/** Lists the external keys of a company's live items of an integration type. */
export function listItemKeys(db: DatabaseSync, companyId: string, type: IntegrationType): Set<string> {
  return new Set(
    queryAll<{ external_key: string }>(
      db,
      `SELECT i.external_key FROM integration_items i JOIN integrations g ON g.id = i.integration_id
       WHERE i.company_id = ? AND g.type = ? AND i.deleted_at IS NULL AND g.status <> 'deleted'`,
      [companyId, type],
    ).map((row) => row.external_key),
  )
}

/** Finds a live item of an integration. */
export function findItem(db: DatabaseSync, integrationId: string, itemId: string): ItemRow | undefined {
  return queryOne<ItemRow>(db, 'SELECT * FROM integration_items WHERE integration_id = ? AND id = ? AND deleted_at IS NULL', [integrationId, itemId])
}

/** Finds a live item by ID within a company. */
export function findCompanyItem(db: DatabaseSync, companyId: string, itemId: string): ItemRow | undefined {
  return queryOne<ItemRow>(db, 'SELECT * FROM integration_items WHERE company_id = ? AND id = ? AND deleted_at IS NULL', [companyId, itemId])
}

/** Inserts an item. */
export function insertItem(db: DatabaseSync, row: ItemRow): void {
  execute(
    db,
    `INSERT INTO integration_items (id, company_id, integration_id, kind, external_key, name, number_enc, masked_number, account_type, currency_code,
       holder, open_date, balance, is_active, is_visible_on_cash_report, is_scrap_available, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.company_id,
      row.integration_id,
      row.kind,
      row.external_key,
      row.name,
      row.number_enc,
      row.masked_number,
      row.account_type,
      row.currency_code,
      row.holder,
      row.open_date,
      row.balance,
      row.is_active,
      row.is_visible_on_cash_report,
      row.is_scrap_available,
      row.created_at,
      row.modified_at,
    ],
  )
}

/** Updates an item's editable fields. */
export function updateItem(
  db: DatabaseSync,
  itemId: string,
  values: Pick<ItemRow, 'name' | 'number_enc' | 'masked_number' | 'is_active' | 'is_visible_on_cash_report'>,
  now: string,
): void {
  execute(db, 'UPDATE integration_items SET name = ?, number_enc = ?, masked_number = ?, is_active = ?, is_visible_on_cash_report = ?, modified_at = ? WHERE id = ?', [
    values.name,
    values.number_enc,
    values.masked_number,
    values.is_active,
    values.is_visible_on_cash_report,
    now,
    itemId,
  ])
}

/** Retires one item. */
export function deleteItem(db: DatabaseSync, itemId: string, now: string): void {
  execute(db, 'UPDATE integration_items SET deleted_at = ?, is_active = 0 WHERE id = ?', [now, itemId])
}

/** Lists a company's live certificates. */
export function listCertificates(db: DatabaseSync, companyId: string): CertificateRow[] {
  return queryAll<CertificateRow>(db, 'SELECT * FROM certificates WHERE company_id = ? AND deleted_at IS NULL ORDER BY end_date DESC, id', [companyId])
}

/** Finds a certificate within a company, including deleted ones. */
export function findCertificate(db: DatabaseSync, companyId: string, certificateId: string): CertificateRow | undefined {
  return queryOne<CertificateRow>(db, 'SELECT * FROM certificates WHERE company_id = ? AND id = ?', [companyId, certificateId])
}

/** Finds a live certificate by serial number. */
export function findCertificateBySerial(db: DatabaseSync, companyId: string, serial: string): CertificateRow | undefined {
  return queryOne<CertificateRow>(db, 'SELECT * FROM certificates WHERE company_id = ? AND serial = ? AND deleted_at IS NULL', [companyId, serial])
}

/** Inserts a certificate. */
export function insertCertificate(db: DatabaseSync, row: CertificateRow): void {
  execute(
    db,
    `INSERT INTO certificates (id, company_id, cert_name, subject_dn, oid, cert_type, usage, organization_code, serial, pub_date, end_date, owner_name,
       owner_business_number, status, cert_blob_enc, key_blob_enc, sign_pw_enc, registered_by, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.company_id,
      row.cert_name,
      row.subject_dn,
      row.oid,
      row.cert_type,
      row.usage,
      row.organization_code,
      row.serial,
      row.pub_date,
      row.end_date,
      row.owner_name,
      row.owner_business_number,
      row.status,
      row.cert_blob_enc,
      row.key_blob_enc,
      row.sign_pw_enc,
      row.registered_by,
      row.created_at,
      row.modified_at,
    ],
  )
}

/** Soft-deletes a certificate and wipes its key material. */
export function deleteCertificate(db: DatabaseSync, certificateId: string, now: string): void {
  execute(db, "UPDATE certificates SET deleted_at = ?, modified_at = ?, key_blob_enc = '', sign_pw_enc = '' WHERE id = ?", [now, now, certificateId])
}

/** Inserts a scrap request. */
export function insertScrapRequest(db: DatabaseSync, row: ScrapRequestRow): void {
  execute(
    db,
    `INSERT INTO scrap_requests (id, company_id, service, status, requested_at, finished_at, group_id, requester, requested_by, integration_id, item_id,
       options, code, message, is_initial, next_available_at, timeout_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.company_id,
      row.service,
      row.status,
      row.requested_at,
      row.finished_at,
      row.group_id,
      row.requester,
      row.requested_by,
      row.integration_id,
      row.item_id,
      row.options,
      row.code,
      row.message,
      row.is_initial,
      row.next_available_at,
      row.timeout_at,
    ],
  )
}

/** Finds the latest scrap request of a service. */
export function findLatestScrapRequest(db: DatabaseSync, companyId: string, service: IntegrationType): ScrapRequestRow | undefined {
  return queryOne<ScrapRequestRow>(db, 'SELECT * FROM scrap_requests WHERE company_id = ? AND service = ? ORDER BY requested_at DESC, rowid DESC LIMIT 1', [
    companyId,
    service,
  ])
}

/** Finds the scrap requests of a request ID or a group ID. */
export function findScrapRequests(db: DatabaseSync, companyId: string, id: string): ScrapRequestRow[] {
  return queryAll<ScrapRequestRow>(db, 'SELECT * FROM scrap_requests WHERE company_id = ? AND (id = ? OR group_id = ?) ORDER BY rowid', [companyId, id, id])
}

/** Lists scrap requests that are still running, across companies. */
export function listOpenScrapRequests(db: DatabaseSync): ScrapRequestRow[] {
  return queryAll<ScrapRequestRow>(db, "SELECT * FROM scrap_requests WHERE status = 'request' ORDER BY requested_at, rowid")
}

/** Finishes a scrap request. */
export function finishScrapRequest(db: DatabaseSync, requestId: string, status: 'done' | 'timeout', code: string, message: string, now: string): void {
  execute(db, "UPDATE scrap_requests SET status = ?, code = ?, message = ?, finished_at = ? WHERE id = ? AND status = 'request'", [
    status,
    code,
    message,
    now,
    requestId,
  ])
}

/** Inserts a scrap result. */
export function insertScrapResult(db: DatabaseSync, row: ScrapResultRow): void {
  execute(
    db,
    `INSERT INTO scrap_results (id, company_id, request_id, service, integration_id, item_id, status, code, message, message_content, is_initial,
       is_retryable, record_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.company_id,
      row.request_id,
      row.service,
      row.integration_id,
      row.item_id,
      row.status,
      row.code,
      row.message,
      row.message_content,
      row.is_initial,
      row.is_retryable,
      row.record_count,
      row.created_at,
    ],
  )
}

/** Finds the latest scrap result of an integration, or of one item when `itemId` is given. */
export function findLatestResult(db: DatabaseSync, integrationId: string, itemId: string | null): ScrapResultRow | undefined {
  return itemId === null
    ? queryOne<ScrapResultRow>(db, 'SELECT * FROM scrap_results WHERE integration_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [integrationId])
    : queryOne<ScrapResultRow>(db, 'SELECT * FROM scrap_results WHERE integration_id = ? AND item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [
        integrationId,
        itemId,
      ])
}

/** Lists the scrap results produced by a set of requests. */
export function listResultsOfRequests(db: DatabaseSync, requestIds: readonly string[]): ScrapResultRow[] {
  return requestIds.flatMap((id) => queryAll<ScrapResultRow>(db, 'SELECT * FROM scrap_results WHERE request_id = ?', [id]))
}

/** Checks whether a company has ever collected data for a service. */
export function hasScrapResults(db: DatabaseSync, companyId: string, service: IntegrationType): boolean {
  return queryOne<{ found: number }>(db, 'SELECT 1 AS found FROM scrap_results WHERE company_id = ? AND service = ? LIMIT 1', [companyId, service]) !== undefined
}
