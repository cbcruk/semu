import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import type { CompanyRow } from '../../companies/companies.types'
import type { CandidateQuery, IntegrationAuthType, IntegrationType, ScrapCandidate, ScrapCredential } from '../adapters/scraping.adapter'
import type { PlatformDeps } from '../platform.types'
import { newId } from '../platform.utils'
import { certificateMaterial, certificateStatusOf, requireLiveCertificate } from './certificates.service'
import { isCertAllowedFor, serializeCertificate } from './certificates.utils'
import {
  countCompanyItems,
  deleteIntegration,
  deleteItem,
  findCertificate,
  findCompanyItem,
  findCredential,
  findIntegration,
  findItem,
  findLatestResult,
  findLatestScrapRequest,
  insertIntegration,
  insertItem,
  listIntegrations,
  listItemKeys,
  listItems,
  replaceCredential,
  updateItem,
} from './integrations.repository'
import type { AuthInput, CertificateRow, IntegrationRow, ItemKind, ItemRow, StoredCredential } from './integrations.types'
import {
  INTEGRATION_TYPES,
  isRetryable,
  MAX_REGISTER_COUNT,
  maskNumber,
  PG_KEYS,
  serializeAccount,
  serializeCard,
  serializeScrapRequest,
  serializeScrapStatus,
  serializeStore,
} from './integrations.utils'

interface ResolvedAuth {
  authType: IntegrationAuthType
  accountId: string | null
  secrets: StoredCredential
  certificate: CertificateRow | null
}

interface RegisterSpec extends ResolvedAuth {
  type: IntegrationType
  subCode: string | null
  isCorporate: boolean
  items: { kind: ItemKind; candidate: ScrapCandidate }[]
}

/**
 * Resolves registration credentials: a registered certificate with its signing password, or an ID and password.
 *
 * @throws {DomainError} `CERT_NOT_ALLOWED_FOR_SERVICE` when the certificate's
 * type does not fit the institution, or `VALIDATION_FAILED`.
 */
export function resolveAuth(deps: ServiceDeps, company: CompanyRow, type: IntegrationType, auth: AuthInput, allowCertificate: boolean): ResolvedAuth {
  if (auth.cert_id !== undefined) {
    if (!allowCertificate) throw invalidField('cert_id', 'This institution does not accept certificates.')
    const cert = requireLiveCertificate(deps, company.id, auth.cert_id)
    const status = certificateStatusOf(deps, company.id, cert.id)
    if (status !== 'ACTIVE') throw invalidField('cert_id', `The certificate is ${status?.toLowerCase() ?? 'missing'}.`)
    if (!isCertAllowedFor(cert, type, company.business_type)) {
      throw new DomainError('CERT_NOT_ALLOWED_FOR_SERVICE', 'This certificate type cannot be used for this institution.')
    }
    if (auth.sign_pw === undefined || certificateMaterial(deps, cert).signPw !== auth.sign_pw) throw invalidField('sign_pw', 'The certificate password is incorrect.')
    return { authType: 'certificate', accountId: null, secrets: {}, certificate: cert }
  }
  if (auth.account_id === undefined || auth.account_id === '') throw invalidField('account_id', 'Enter the institution ID.')
  if (auth.account_pw === undefined || auth.account_pw === '') throw invalidField('account_pw', 'Enter the institution password.')
  return { authType: 'id', accountId: auth.account_id, secrets: { password: auth.account_pw }, certificate: null }
}

/**
 * Lists cards or accounts reachable with credentials, marking ones already registered.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when the institution rejects the credentials.
 */
export async function requestCandidates(
  deps: PlatformDeps,
  company: CompanyRow,
  type: 'creditcard' | 'bank',
  codes: readonly string[],
  isCorporate: boolean,
  auth: AuthInput,
): Promise<Record<string, unknown>[]> {
  const resolved = resolveAuth(deps, company, type, auth, true)
  if (resolved.authType === 'id' && codes.length !== 1) throw invalidField(type === 'bank' ? 'bank_codes' : 'card_codes', 'ID login covers one institution at a time.')
  const registered = listItemKeys(deps.db, company.id, type)
  const results: Record<string, unknown>[] = []
  for (const code of codes) {
    for (const candidate of await fetchCandidates(deps, company, type, code, isCorporate, resolved)) {
      const base = { external_key: candidate.externalKey, name: candidate.name, masked_number: candidate.number === null ? null : maskNumber(candidate.number), is_registered: registered.has(candidate.externalKey) }
      results.push(type === 'bank' ? { bank_code: code, account_type: candidate.accountType ?? null, ...base } : { creditcard_code: code, ...base })
    }
  }
  return results
}

/**
 * Registers a card company or bank link with the selected cards or accounts.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for unknown selections or when the 20-item limit would be exceeded.
 */
export async function registerWithItems(
  deps: PlatformDeps,
  company: CompanyRow,
  type: 'creditcard' | 'bank',
  input: { code: string; isCorporate: boolean; auth: AuthInput; externalKeys: readonly string[] },
): Promise<IntegrationRow> {
  const resolved = resolveAuth(deps, company, type, input.auth, true)
  const candidates = await fetchCandidates(deps, company, type, input.code, input.isCorporate, resolved)
  const registered = listItemKeys(deps.db, company.id, type)
  const selected = candidates.filter((candidate) => input.externalKeys.includes(candidate.externalKey) && !registered.has(candidate.externalKey))
  if (selected.length === 0) throw invalidField(type === 'bank' ? 'accounts' : 'cards', 'Select at least one new item.')
  const kind: ItemKind = type === 'bank' ? 'account' : 'card'
  assertLimit(deps, company.id, type, kind, selected.length)
  return register(deps, company, { ...resolved, type, subCode: input.code, isCorporate: input.isCorporate, items: selected.map((candidate) => ({ kind, candidate })) })
}

/**
 * Registers an integration that has no selectable items: Hometax, card sales, Giro, speed bank or PG.
 *
 * @throws {DomainError} `CONFLICT` when the same link already exists, or `VALIDATION_FAILED`.
 */
export async function registerSimple(
  deps: PlatformDeps,
  company: CompanyRow,
  type: 'hometax' | 'cardsales' | 'giro' | 'speedbank',
  input: { subCode?: string | null; auth: AuthInput; transientSecrets?: { accountId: string; password: string } | undefined },
): Promise<IntegrationRow> {
  const resolved = resolveAuth(deps, company, type, input.auth, type === 'hometax' || type === 'giro')
  if (type === 'giro' && resolved.certificate === null) throw invalidField('cert_id', 'Internet Giro needs a certificate.')
  const authType: IntegrationAuthType = type === 'speedbank' ? 'speedbank' : resolved.authType
  const duplicate = listIntegrations(deps.db, company.id, type).some(
    (row) => row.auth_type === authType && (type === 'speedbank' ? row.sub_code === (input.subCode ?? null) && row.account_id === resolved.accountId : true),
  )
  if (duplicate) throw new DomainError('CONFLICT', 'This institution is already connected.')
  return register(
    deps,
    company,
    { ...resolved, authType, type, subCode: input.subCode ?? null, isCorporate: company.business_type === 'corporate', items: [] },
    input.transientSecrets,
  )
}

/**
 * Registers a PG merchant ID with the keys that PG requires.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for missing keys, `CF_` Toss MIDs or the 20-MID limit, or `CONFLICT` for duplicates.
 */
export async function registerPg(deps: PlatformDeps, company: CompanyRow, input: { pg_company: string; mid: string; keys: Record<string, string> }): Promise<IntegrationRow> {
  const spec = PG_KEYS[input.pg_company]
  if (spec === undefined) throw invalidField('pg_company', 'Unknown PG company.')
  if (input.pg_company === 'TOSSPAYMENTS' && input.mid.startsWith('CF_')) throw invalidField('mid', 'MIDs starting with CF_ cannot be connected.')
  const missing = spec.required.filter((key) => (input.keys[key] ?? '') === '')
  if (missing.length > 0) throw invalidField(missing[0] ?? 'keys', `Enter ${missing.join(', ')}.`)
  const existing = listIntegrations(deps.db, company.id, 'pg')
  if (existing.some((row) => row.sub_code === input.pg_company && row.account_id === input.mid)) throw new DomainError('CONFLICT', 'This MID is already connected.')
  if (existing.length >= MAX_REGISTER_COUNT) throw invalidField('mid', `Up to ${MAX_REGISTER_COUNT} PG accounts can be connected.`)
  const keys = Object.fromEntries(spec.required.map((key) => [key, input.keys[key] ?? '']))
  return register(deps, company, {
    authType: 'api_key',
    accountId: input.mid,
    secrets: { keys },
    certificate: null,
    type: 'pg',
    subCode: input.pg_company,
    isCorporate: company.business_type === 'corporate',
    items: [],
  })
}

/**
 * Registers a delivery app account and every store it reports.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for unknown apps or the 20-store limit.
 */
export async function registerDelivery(deps: PlatformDeps, company: CompanyRow, input: { delivery_corp: string; auth: AuthInput }): Promise<IntegrationRow> {
  const resolved = resolveAuth(deps, company, 'delivery', input.auth, false)
  const stores = await fetchCandidates(deps, company, 'delivery', input.delivery_corp, company.business_type === 'corporate', resolved)
  const registered = listItemKeys(deps.db, company.id, 'delivery')
  const fresh = stores.filter((store) => !registered.has(store.externalKey))
  if (fresh.length === 0) throw new DomainError('CONFLICT', 'Every store of this account is already connected.')
  assertLimit(deps, company.id, 'delivery', 'store', fresh.length)
  return register(deps, company, {
    ...resolved,
    type: 'delivery',
    subCode: input.delivery_corp,
    isCorporate: company.business_type === 'corporate',
    items: fresh.map((candidate) => ({ kind: 'store', candidate })),
  })
}

/**
 * Changes a speed bank account's credentials or account number after checking them.
 *
 * @throws {DomainError} `NOT_FOUND` or `VALIDATION_FAILED`.
 */
export async function updateSpeedbank(
  deps: PlatformDeps,
  company: CompanyRow,
  integrationId: string,
  input: { account_id?: string | undefined; account_pw?: string | undefined },
): Promise<IntegrationRow> {
  const integration = requireIntegration(deps, company.id, integrationId, 'speedbank')
  const current = readSecrets(deps, integration)
  const accountId = input.account_id ?? integration.account_id ?? ''
  const password = input.account_pw ?? current.password ?? ''
  const check = await deps.scraping.verifyCredential({
    type: 'speedbank',
    subCode: integration.sub_code,
    isCorporate: integration.is_corporate === 1,
    businessNumber: company.business_number,
    credential: { authType: 'speedbank', accountId, password },
  })
  if (!check.ok) throw invalidField('account_pw', check.message)
  replaceCredential(deps.db, integration.id, accountId, deps.cipher.encrypt(JSON.stringify({ password })), deps.clock.now())
  return requireIntegration(deps, company.id, integrationId, 'speedbank')
}

/**
 * Loads a live integration, optionally requiring its type.
 *
 * @throws {DomainError} `NOT_FOUND`.
 */
export function requireIntegration(deps: ServiceDeps, companyId: string, integrationId: string, type?: IntegrationType): IntegrationRow {
  const row = findIntegration(deps.db, companyId, integrationId)
  if (row === undefined || (type !== undefined && row.type !== type)) throw notFound('Integration')
  return row
}

/** Deletes an integration and destroys its credential; collected history stays. */
export function removeIntegration(deps: ServiceDeps, companyId: string, integrationId: string, type?: IntegrationType): void {
  const row = requireIntegration(deps, companyId, integrationId, type)
  deleteIntegration(deps.db, row.id, deps.clock.now())
}

/** Retires one card, account or store; removing an integration's last item removes the integration. */
export function removeItem(deps: ServiceDeps, companyId: string, integrationId: string | null, itemId: string, type: IntegrationType): void {
  transaction(deps.db, () => {
    const item = integrationId === null ? findCompanyItemOfType(deps, companyId, itemId, type) : findItem(deps.db, requireIntegration(deps, companyId, integrationId, type).id, itemId)
    if (item === undefined) throw notFound('Item')
    const now = deps.clock.now()
    deleteItem(deps.db, item.id, now)
    if (listItems(deps.db, item.integration_id).length === 0) deleteIntegration(deps.db, item.integration_id, now)
  })
}

/** Corrects a card number the institution reported partially masked; only the masked form is ever returned. */
export function correctCardNumber(deps: ServiceDeps, companyId: string, integrationId: string, cardId: string, cardNumber: string): Record<string, unknown> {
  const integration = requireIntegration(deps, companyId, integrationId, 'creditcard')
  const item = findItem(deps.db, integration.id, cardId)
  if (item === undefined) throw notFound('Card')
  const digits = cardNumber.replace(/\D/g, '')
  if (digits.length < 14 || digits.length > 16) throw invalidField('card_number', 'Enter the full card number.')
  updateItem(deps.db, item.id, { ...item, number_enc: deps.cipher.encrypt(digits), masked_number: maskNumber(digits) }, deps.clock.now())
  const updated = findItem(deps.db, integration.id, cardId)
  if (updated === undefined) throw notFound('Card')
  return serializeCard(updated, findLatestResult(deps.db, integration.id, updated.id))
}

/** Toggles bank accounts on or off, renames them, or hides them from the cash report. */
export function patchBankAccounts(
  deps: ServiceDeps,
  companyId: string,
  changes: readonly { id: string; is_active?: boolean | undefined; is_visible_on_cash_report?: boolean | undefined; account_name?: string | undefined }[],
): Record<string, unknown>[] {
  return transaction(deps.db, () =>
    changes.map((change) => {
      const item = findCompanyItemOfType(deps, companyId, change.id, 'bank')
      if (item === undefined) throw notFound('Account')
      updateItem(
        deps.db,
        item.id,
        {
          name: change.account_name ?? item.name,
          number_enc: item.number_enc,
          masked_number: item.masked_number,
          is_active: change.is_active === undefined ? item.is_active : change.is_active ? 1 : 0,
          is_visible_on_cash_report: change.is_visible_on_cash_report === undefined ? item.is_visible_on_cash_report : change.is_visible_on_cash_report ? 1 : 0,
        },
        deps.clock.now(),
      )
      const updated = findItem(deps.db, item.integration_id, item.id)
      if (updated === undefined) throw notFound('Account')
      return serializeAccount(updated, findLatestResult(deps.db, item.integration_id, item.id))
    }),
  )
}

/** Serializes one integration in the shape its type's screens expect; credentials never leave the server. */
export function serializeIntegration(deps: ServiceDeps, row: IntegrationRow, options: { activeOnly?: boolean } = {}): Record<string, unknown> {
  const today = deps.clock.today()
  const cert = row.certificate_id === null ? undefined : findCertificate(deps.db, row.company_id, row.certificate_id)
  const certificate = cert === undefined ? null : serializeCertificate(cert, today)
  const last = findLatestResult(deps.db, row.id, null)
  const items = listItems(deps.db, row.id).filter((item) => options.activeOnly !== true || item.is_active === 1)
  const base = {
    id: row.id,
    integration_type: row.type,
    auth_type: row.auth_type === 'certificate' ? 'CERTIFICATE' : 'ID',
    is_corporate: row.is_corporate === 1,
    is_active: row.status === 'active',
    status: row.status,
    certificate,
    account_id: row.account_id,
    last_scrap_status: serializeScrapStatus(last),
    created: row.created_at,
    modified: row.modified_at,
  }
  switch (row.type) {
    case 'creditcard':
      return { ...base, creditcard_code: row.sub_code, card_list: items.map((item) => serializeCard(item, findLatestResult(deps.db, row.id, item.id))) }
    case 'bank':
      return { ...base, bank_code: row.sub_code, account_list: items.map((item) => serializeAccount(item, findLatestResult(deps.db, row.id, item.id))) }
    case 'delivery':
      return { ...base, delivery_corp: row.sub_code, stores: items.map((item) => serializeStore(item, findLatestResult(deps.db, row.id, item.id))) }
    case 'pg':
      return { ...base, pg_company: row.sub_code, mid: row.account_id, keys: publicPgKeys(deps, row) }
    case 'speedbank':
      return { ...base, bank_code: row.sub_code }
    default:
      return base
  }
}

/** Builds the `GET /integrations/v2/` blocks for one type or for all types. */
export function integrationBlocks(deps: ServiceDeps, companyId: string, type: IntegrationType | undefined): Record<string, unknown> {
  const now = deps.clock.now()
  const types = type === undefined ? INTEGRATION_TYPES : [type]
  const block = (kind: IntegrationType): Record<string, unknown> => {
    const rows = listIntegrations(deps.db, companyId, kind).map((row) => serializeIntegration(deps, row))
    const request = serializeScrapRequest(findLatestScrapRequest(deps.db, companyId, kind), kind, companyId, now)
    switch (kind) {
      case 'hometax':
        return {
          cert_info: rows.find((row) => row['auth_type'] === 'CERTIFICATE') ?? null,
          account_info: rows.find((row) => row['auth_type'] === 'ID') ?? null,
          last_hometax_scrap_request_status: request,
        }
      case 'giro':
        return { giro_info: rows[0] ?? null, last_giro_scrap_request_status: request }
      case 'cardsales':
        return { cardsales_info: rows[0] ?? null, last_cardsales_scrap_request_status: request }
      case 'creditcard':
        return { cards: rows, max_register_creditcard_count: MAX_REGISTER_COUNT, last_creditcard_scrap_request_status: request }
      case 'bank':
        return { banks: rows, max_register_bank_account_count: MAX_REGISTER_COUNT, last_bank_scrap_request_status: request }
      case 'allra':
        return { allra_info: rows[0] ?? null, last_allra_scrap_request_status: request }
      case 'speedbank':
        return { speedbanks: rows }
      case 'pg':
        return { pgs: rows, max_register_pg_count: MAX_REGISTER_COUNT, scrap_request: request }
      case 'delivery':
        return { delivery_list: rows, max_register_delivery_count: MAX_REGISTER_COUNT, scrap_request: request }
    }
  }
  return Object.fromEntries(types.map((kind) => [kind, block(kind)]))
}

/** Builds the `GET /integrations/status/` arrays, with `is_retryable` computed on the server. */
export function integrationStatus(deps: ServiceDeps, companyId: string, type: IntegrationType | undefined): Record<string, unknown> {
  const types = type === undefined ? INTEGRATION_TYPES : [type]
  const lastScrapping = (integrationId: string, itemId: string | null, retryable: boolean): Record<string, unknown> | null => {
    const last = findLatestResult(deps.db, integrationId, itemId)
    return last === undefined ? null : { status: last.status, code: last.code, message: last.message, is_retryable: retryable, created: last.created_at }
  }
  const entries = types.map((kind) => [
    kind,
    listIntegrations(deps.db, companyId, kind).map((row) => {
      const certificate = certificateStatusOf(deps, companyId, row.certificate_id)
      const retryable = isRetryable(row, certificate, findLatestResult(deps.db, row.id, null))
      const items = listItems(deps.db, row.id)
      return {
        id: row.id,
        auth_type: row.auth_type === 'certificate' ? 'CERTIFICATE' : 'ID',
        sub_code: row.sub_code,
        is_active: row.status === 'active',
        certificate,
        is_retryable: retryable,
        last_scrapping: lastScrapping(row.id, null, retryable),
        ...(items.length === 0
          ? {}
          : {
              accounts: items.map((item) => ({
                id: item.id,
                kind: item.kind,
                is_active: item.is_active === 1,
                last_scrapping: lastScrapping(row.id, item.id, retryable && item.is_active === 1),
              })),
            }),
      }
    }),
  ])
  return { integration_status: Object.fromEntries(entries) }
}

/** Decrypts an integration's credentials, adding certificate material for certificate links. */
export function scrapCredentialOf(deps: ServiceDeps, integration: IntegrationRow): ScrapCredential {
  const secrets = readSecrets(deps, integration)
  const cert = integration.certificate_id === null ? undefined : findCertificate(deps.db, integration.company_id, integration.certificate_id)
  return {
    authType: integration.auth_type,
    ...(integration.account_id === null ? {} : { accountId: integration.account_id }),
    ...(secrets.password === undefined ? {} : { password: secrets.password }),
    ...(secrets.keys === undefined ? {} : { keys: secrets.keys }),
    ...(cert === undefined || cert.deleted_at !== null ? {} : { certificate: certificateMaterial(deps, cert) }),
  }
}

async function register(deps: PlatformDeps, company: CompanyRow, spec: RegisterSpec, transientSecrets?: { accountId: string; password: string }): Promise<IntegrationRow> {
  const credential: ScrapCredential = {
    authType: spec.authType,
    ...(transientSecrets === undefined ? {} : { accountId: transientSecrets.accountId, password: transientSecrets.password }),
    ...(spec.accountId === null ? {} : { accountId: spec.accountId }),
    ...(spec.secrets.password === undefined ? {} : { password: spec.secrets.password }),
    ...(spec.secrets.keys === undefined ? {} : { keys: spec.secrets.keys }),
    ...(spec.certificate === null ? {} : { certificate: certificateMaterial(deps, spec.certificate) }),
  }
  const check = await deps.scraping.verifyCredential({ type: spec.type, subCode: spec.subCode, isCorporate: spec.isCorporate, businessNumber: company.business_number, credential })
  if (!check.ok) throw invalidField(spec.authType === 'certificate' ? 'sign_pw' : spec.authType === 'api_key' ? 'keys' : 'account_pw', check.message)
  const now = deps.clock.now()
  const row: IntegrationRow = {
    id: newId('int'),
    company_id: company.id,
    type: spec.type,
    sub_code: spec.subCode,
    auth_type: spec.authType,
    is_corporate: spec.isCorporate ? 1 : 0,
    certificate_id: spec.certificate?.id ?? null,
    account_id: spec.accountId,
    status: 'active',
    created_at: now,
    modified_at: now,
    deleted_at: null,
  }
  transaction(deps.db, () => {
    insertIntegration(deps.db, row, deps.cipher.encrypt(JSON.stringify(spec.secrets)))
    for (const { kind, candidate } of spec.items) insertItem(deps.db, toItem(deps, row, kind, candidate, now))
  })
  return row
}

async function fetchCandidates(deps: PlatformDeps, company: CompanyRow, type: CandidateQuery['type'], code: string, isCorporate: boolean, resolved: ResolvedAuth): Promise<ScrapCandidate[]> {
  const credential: ScrapCredential = {
    authType: resolved.authType,
    ...(resolved.accountId === null ? {} : { accountId: resolved.accountId }),
    ...(resolved.secrets.password === undefined ? {} : { password: resolved.secrets.password }),
    ...(resolved.certificate === null ? {} : { certificate: certificateMaterial(deps, resolved.certificate) }),
  }
  try {
    return await deps.scraping.listCandidates({ type, subCode: code, isCorporate, businessNumber: company.business_number, credential })
  } catch (error) {
    throw invalidField(resolved.authType === 'certificate' ? 'sign_pw' : 'account_pw', error instanceof Error ? error.message : 'The institution rejected the request.')
  }
}

function toItem(deps: ServiceDeps, integration: IntegrationRow, kind: ItemKind, candidate: ScrapCandidate, now: string): ItemRow {
  return {
    id: newId(kind),
    company_id: integration.company_id,
    integration_id: integration.id,
    kind,
    external_key: candidate.externalKey,
    name: candidate.name,
    number_enc: candidate.number === null ? null : deps.cipher.encrypt(candidate.number),
    masked_number: candidate.number === null ? null : maskNumber(candidate.number),
    account_type: candidate.accountType ?? null,
    currency_code: candidate.currencyCode ?? null,
    holder: candidate.holder ?? null,
    open_date: candidate.openDate ?? null,
    balance: candidate.balance ?? null,
    is_active: 1,
    is_visible_on_cash_report: 1,
    is_scrap_available: 1,
    created_at: now,
    modified_at: now,
    deleted_at: null,
  }
}

function assertLimit(deps: ServiceDeps, companyId: string, type: IntegrationType, kind: ItemKind, adding: number): void {
  if (countCompanyItems(deps.db, companyId, type, kind) + adding > MAX_REGISTER_COUNT) {
    throw invalidField('items', `Up to ${MAX_REGISTER_COUNT} items can be registered.`)
  }
}

function readSecrets(deps: ServiceDeps, integration: IntegrationRow): StoredCredential {
  const ciphertext = findCredential(deps.db, integration.id)
  return ciphertext === undefined ? {} : (JSON.parse(deps.cipher.decrypt(ciphertext)) as StoredCredential)
}

function publicPgKeys(deps: ServiceDeps, row: IntegrationRow): Record<string, string> {
  const spec = row.sub_code === null ? undefined : PG_KEYS[row.sub_code]
  const keys = readSecrets(deps, row).keys ?? {}
  return Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, spec?.secret.includes(key) === true ? '********' : value]))
}

function findCompanyItemOfType(deps: ServiceDeps, companyId: string, itemId: string, type: IntegrationType): ItemRow | undefined {
  const item = findCompanyItem(deps.db, companyId, itemId)
  if (item === undefined) return undefined
  return findIntegration(deps.db, companyId, item.integration_id)?.type === type ? item : undefined
}
