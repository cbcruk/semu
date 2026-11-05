import type { IntegrationType } from '../adapters/scraping.adapter'
import { secondsUntil } from '../platform.utils'
import type { CertificateStatus, IntegrationRow, ItemRow, ScrapRequestRow, ScrapResultRow } from './integrations.types'

/** Every integration type, in the order the screens list them. */
export const INTEGRATION_TYPES: readonly IntegrationType[] = ['hometax', 'giro', 'cardsales', 'creditcard', 'bank', 'allra', 'speedbank', 'pg', 'delivery']

/** Most cards, accounts, PG MIDs or stores a company may register per type. */
export const MAX_REGISTER_COUNT = 20

/** Seconds a user waits between manual collections of one service. */
export const SCRAP_COOLDOWN_SECONDS = 600

/** Seconds after which an unfinished collection is marked `timeout`. */
export const SCRAP_TIMEOUT_SECONDS = 600

/** Keys each PG needs (M:08-설정/07/05); secret keys are encrypted and never returned. */
export const PG_KEYS: Readonly<Record<string, { required: readonly string[]; secret: readonly string[] }>> = {
  NICEPAY: { required: ['usr_id', 'merchant_key'], secret: ['merchant_key'] },
  TOSSPAYMENTS: { required: ['secret_key'], secret: ['secret_key'] },
  TOSSPAY: { required: ['api_key'], secret: ['api_key'] },
  UPLUS: { required: ['mert_key'], secret: ['mert_key'] },
  NAVERPAY: { required: ['settlement_api_key', 'client_id', 'client_secret', 'chain_id'], secret: ['settlement_api_key', 'client_secret'] },
  HECTO: { required: ['license_key'], secret: ['license_key'] },
  INICIS: { required: ['reconciliation_password'], secret: ['reconciliation_password'] },
  EXIMBAY: { required: ['secret_key'], secret: ['secret_key'] },
  KSNET: { required: ['reconciliation_api_key'], secret: ['reconciliation_api_key'] },
}

/** Delivery apps that can be connected. */
export const DELIVERY_CORPS = ['baemin', 'coupangeats', 'yogiyo'] as const

/** Checks whether a string is a known integration type. */
export function isIntegrationType(value: string): value is IntegrationType {
  return (INTEGRATION_TYPES as readonly string[]).includes(value)
}

/** Serializes a scrap result as the legacy `ScrapStatus` object. */
export function serializeScrapStatus(row: ScrapResultRow | undefined): Record<string, unknown> | null {
  if (row === undefined) return null
  return {
    id: row.id,
    company: row.company_id,
    status: row.status,
    code: row.code,
    message: row.message,
    message_content: row.message_content,
    is_initial: row.is_initial === 1,
    is_scrap_available: true,
    is_retryable: row.is_retryable === 1,
    created: row.created_at,
    modified: row.created_at,
  }
}

/**
 * Serializes a scrap request with the manual-collection cooldown.
 *
 * `can_scrapping` is false while a request runs or until `next_available_at`;
 * `remain_seconds` counts down to that moment.
 */
export function serializeScrapRequest(row: ScrapRequestRow | undefined, service: IntegrationType, companyId: string, now: string): Record<string, unknown> {
  if (row === undefined) {
    return { id: null, company: companyId, service, requester: null, code: null, message: null, status: null, is_initial: true, can_scrapping: true, remain_seconds: 0, created: null, modified: null }
  }
  const remain = row.requester === 'user' && row.next_available_at !== null ? secondsUntil(now, row.next_available_at) : 0
  return {
    id: row.id,
    company: row.company_id,
    service: row.service,
    requester: row.requester,
    code: row.code,
    message: row.message,
    status: row.status,
    is_initial: row.is_initial === 1,
    can_scrapping: row.status !== 'request' && remain === 0,
    remain_seconds: remain,
    created: row.requested_at,
    modified: row.finished_at ?? row.requested_at,
  }
}

/** Serializes a card item as the legacy `cardList` entry. */
export function serializeCard(item: ItemRow, lastStatus: ScrapResultRow | undefined): Record<string, unknown> {
  return {
    id: item.id,
    integration_id: item.integration_id,
    card_name: item.name,
    card_number: item.masked_number,
    masked_card_number: item.masked_number,
    is_scrap_available: item.is_scrap_available === 1,
    is_active: item.is_active === 1,
    last_scrap_status: serializeScrapStatus(lastStatus),
    created: item.created_at,
    modified: item.modified_at,
  }
}

/** Serializes an account item as the legacy `accountList` entry; the full number is never returned. */
export function serializeAccount(item: ItemRow, lastStatus: ScrapResultRow | undefined): Record<string, unknown> {
  return {
    id: item.id,
    integration_id: item.integration_id,
    account_name: item.name,
    account_number: item.masked_number,
    account_type: item.account_type,
    open_date: item.open_date,
    end_date: null,
    balance: item.balance,
    currency_code: item.currency_code,
    is_dormant: false,
    holder: item.holder,
    last_transaction_date: lastStatus?.status === 'success' ? lastStatus.created_at.slice(0, 10) : null,
    is_scrap_available: item.is_scrap_available === 1,
    last_scrap_status: serializeScrapStatus(lastStatus),
    is_active: item.is_active === 1,
    external_key: item.external_key,
    is_visible_on_cash_report: item.is_visible_on_cash_report === 1,
  }
}

/** Serializes a delivery store item. */
export function serializeStore(item: ItemRow, lastStatus: ScrapResultRow | undefined): Record<string, unknown> {
  return { id: item.id, integration_id: item.integration_id, store_name: item.name, external_key: item.external_key, is_active: item.is_active === 1, last_scrap_status: serializeScrapStatus(lastStatus) }
}

/**
 * Computes whether the client may offer "retry" for an integration (B:91826-91900).
 *
 * Certificate-based links with an expired or inactive certificate cannot be
 * retried; otherwise the latest result decides, and no result means retryable.
 */
export function isRetryable(integration: IntegrationRow, certificate: CertificateStatus | null, lastStatus: ScrapResultRow | undefined): boolean {
  if (integration.auth_type === 'certificate' && (certificate === 'EXPIRED' || certificate === 'INACTIVE' || certificate === 'UNREGISTERED')) return false
  return lastStatus === undefined || lastStatus.is_retryable === 1
}

/** Masks a card or account number, keeping the last four digits. */
export function maskNumber(number: string): string {
  const digits = number.replace(/\D/g, '')
  return digits.length <= 4 ? digits : `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
}
