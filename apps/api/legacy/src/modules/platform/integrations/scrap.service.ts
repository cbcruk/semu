import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField } from '../../../lib/domain-error'
import type { IntegrationType, ScrapOutcome } from '../adapters/scraping.adapter'
import { findCompanyProfile } from '../company-profile/company-profile.repository'
import type { PlatformDeps } from '../platform.types'
import { addSeconds, isBefore, newId, secondsUntil } from '../platform.utils'
import {
  findCompanyItem,
  findIntegration,
  findLatestScrapRequest,
  findScrapRequests,
  finishScrapRequest,
  hasScrapResults,
  insertScrapRequest,
  insertScrapResult,
  listIntegrations,
  listItems,
  listOpenScrapRequests,
  listResultsOfRequests,
} from './integrations.repository'
import { scrapCredentialOf } from './integrations.service'
import type { IntegrationRow, ItemRow, ScrapRequestRow } from './integrations.types'
import { INTEGRATION_TYPES, SCRAP_COOLDOWN_SECONDS, SCRAP_TIMEOUT_SECONDS, serializeScrapRequest } from './integrations.utils'

/** Polling states of `GET /integrations/scraping-status/`. */
export type ScrappingStatus = 'PROGRESS' | 'SUCCESS' | 'FAIL'

/** Options of a manual collection request. */
export interface ScrapRequestOptions {
  integrationId?: string | undefined
  itemId?: string | undefined
  corporationNumberUnused?: boolean | undefined
}

/**
 * Queues a manual collection for one service, enforcing the cooldown.
 *
 * @throws {DomainError} `RATE_LIMITED` (429, with `remain_seconds`) while a
 * collection runs or the cooldown lasts, or `VALIDATION_FAILED` when nothing is connected.
 */
export function requestScrap(deps: ServiceDeps, companyId: string, userId: string, service: IntegrationType, options: ScrapRequestOptions): Record<string, unknown> {
  return transaction(deps.db, () => {
    const now = deps.clock.now()
    assertCanScrap(deps, companyId, service, now)
    const targets = targetIntegrations(deps, companyId, service, options)
    if (targets.length === 0) throw invalidField('service', 'Connect this institution before collecting.')
    const row = buildRequest(deps, companyId, userId, service, options, null, now)
    insertScrapRequest(deps.db, row)
    return serializeScrapRequest(row, service, companyId, now)
  })
}

/**
 * Queues a collection for every connected service that is not cooling down.
 *
 * @returns The group ID to poll and the queued requests.
 */
export function requestAllScrap(deps: ServiceDeps, companyId: string, userId: string): Record<string, unknown> {
  return transaction(deps.db, () => {
    const now = deps.clock.now()
    const groupId = newId('srg')
    const requests: Record<string, unknown>[] = []
    for (const service of INTEGRATION_TYPES) {
      if (listIntegrations(deps.db, companyId, service).length === 0 || cooldownRemaining(deps, companyId, service, now) !== null) continue
      const row = buildRequest(deps, companyId, userId, service, {}, groupId, now)
      insertScrapRequest(deps.db, row)
      requests.push(serializeScrapRequest(row, service, companyId, now))
    }
    return { id: groupId, requests }
  })
}

/** Returns the latest request of a service with the cooldown state. */
export function lastScrapRequest(deps: ServiceDeps, companyId: string, service: IntegrationType): Record<string, unknown> {
  return serializeScrapRequest(findLatestScrapRequest(deps.db, companyId, service), service, companyId, deps.clock.now())
}

/**
 * Summarises the progress of a request or request group for polling.
 *
 * `PROGRESS` while any request runs; `SUCCESS` when all finished without a
 * failed result; `FAIL` when one timed out or any result failed.
 *
 * @throws {DomainError} `NOT_FOUND` for unknown IDs.
 */
export function scrapingStatus(deps: ServiceDeps, companyId: string, id: string): Record<string, unknown> {
  const requests = findScrapRequests(deps.db, companyId, id)
  if (requests.length === 0) throw new DomainError('NOT_FOUND', 'Scrap request not found.')
  const results = listResultsOfRequests(
    deps.db,
    requests.map((row) => row.id),
  )
  let status: ScrappingStatus = 'SUCCESS'
  if (requests.some((row) => row.status === 'request')) status = 'PROGRESS'
  else if (requests.some((row) => row.status === 'timeout') || results.some((row) => row.status === 'fail')) status = 'FAIL'
  return { id, status, requests: requests.map((row) => serializeScrapRequest(row, row.service, companyId, deps.clock.now())) }
}

/**
 * Worker job: runs queued collections through the scraping adapter and times out stale ones.
 *
 * Each integration or item gets a `scrap_results` row; successful batches go
 * to the {@linkcode ScrapResultSink} for bookkeeping. Adapter calls happen
 * outside transactions.
 *
 * @returns How many requests finished and how many timed out.
 */
export async function processScrapQueue(deps: PlatformDeps): Promise<{ done: number; timedOut: number }> {
  let done = 0
  let timedOut = 0
  for (const request of listOpenScrapRequests(deps.db)) {
    const now = deps.clock.now()
    if (request.timeout_at !== null && !isBefore(now, request.timeout_at)) {
      finishScrapRequest(deps.db, request.id, 'timeout', 'TIMEOUT', 'The collection timed out.', now)
      timedOut += 1
      continue
    }
    const company = findCompanyProfile(deps.db, request.company_id)
    if (company === undefined) continue
    const options = request.options === null ? {} : (JSON.parse(request.options) as Record<string, unknown>)
    let failures = 0
    let runs = 0
    for (const integration of targetIntegrations(deps, request.company_id, request.service, { integrationId: request.integration_id ?? undefined, itemId: request.item_id ?? undefined })) {
      for (const item of targetItems(deps, integration, request.item_id)) {
        runs += 1
        const outcome = await runOne(deps, request, integration, item, company.business_number, options)
        if (outcome.status === 'fail') failures += 1
      }
    }
    const finishedAt = deps.clock.now()
    const code = failures === 0 ? 'SUCCESS' : failures === runs ? 'FAIL' : 'PARTIAL'
    finishScrapRequest(deps.db, request.id, 'done', code, `${runs - failures} of ${runs} collected.`, finishedAt)
    done += 1
  }
  return { done, timedOut }
}

async function runOne(
  deps: PlatformDeps,
  request: ScrapRequestRow,
  integration: IntegrationRow,
  item: ItemRow | null,
  businessNumber: string,
  options: Record<string, unknown>,
): Promise<ScrapOutcome> {
  let outcome: ScrapOutcome
  try {
    outcome = await deps.scraping.scrape({
      companyId: request.company_id,
      businessNumber,
      type: integration.type,
      subCode: integration.sub_code,
      integrationId: integration.id,
      itemExternalKey: item?.external_key ?? null,
      credential: scrapCredentialOf(deps, integration),
      options,
      isInitial: request.is_initial === 1,
    })
    if (outcome.status === 'success') {
      await deps.scrapResultSink.ingest({
        companyId: request.company_id,
        service: integration.type,
        integrationId: integration.id,
        itemId: item?.id ?? null,
        requestId: request.id,
        records: outcome.records,
      })
    }
  } catch (error) {
    outcome = { status: 'fail', code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Collection failed.', isRetryable: true }
  }
  insertScrapResult(deps.db, {
    id: newId('scr'),
    company_id: request.company_id,
    request_id: request.id,
    service: integration.type,
    integration_id: integration.id,
    item_id: item?.id ?? null,
    status: outcome.status,
    code: outcome.status === 'success' ? 'SUCCESS' : outcome.code,
    message: outcome.status === 'success' ? null : outcome.message,
    message_content: null,
    is_initial: request.is_initial,
    is_retryable: outcome.status === 'success' || outcome.isRetryable ? 1 : 0,
    record_count: outcome.status === 'success' ? outcome.records.length : 0,
    created_at: deps.clock.now(),
  })
  return outcome
}

function assertCanScrap(deps: ServiceDeps, companyId: string, service: IntegrationType, now: string): void {
  const remain = cooldownRemaining(deps, companyId, service, now)
  if (remain !== null) throw new DomainError('RATE_LIMITED', 'A collection ran recently; try again later.', { remain_seconds: remain })
}

function cooldownRemaining(deps: ServiceDeps, companyId: string, service: IntegrationType, now: string): number | null {
  const latest = findLatestScrapRequest(deps.db, companyId, service)
  if (latest === undefined) return null
  const remain = latest.next_available_at === null ? 0 : secondsUntil(now, latest.next_available_at)
  const stale = latest.timeout_at !== null && !isBefore(now, latest.timeout_at)
  if (latest.status === 'request' && !stale) return Math.max(remain, 1)
  return remain > 0 ? remain : null
}

function buildRequest(
  deps: ServiceDeps,
  companyId: string,
  userId: string,
  service: IntegrationType,
  options: ScrapRequestOptions,
  groupId: string | null,
  now: string,
): ScrapRequestRow {
  return {
    id: newId('sr'),
    company_id: companyId,
    service,
    status: 'request',
    requested_at: now,
    finished_at: null,
    group_id: groupId,
    requester: 'user',
    requested_by: userId,
    integration_id: options.integrationId ?? null,
    item_id: options.itemId ?? null,
    options: JSON.stringify({ corporation_number_unused: options.corporationNumberUnused ?? false }),
    code: null,
    message: null,
    is_initial: hasScrapResults(deps.db, companyId, service) ? 0 : 1,
    next_available_at: addSeconds(now, SCRAP_COOLDOWN_SECONDS),
    timeout_at: addSeconds(now, SCRAP_TIMEOUT_SECONDS),
  }
}

function targetIntegrations(deps: ServiceDeps, companyId: string, service: IntegrationType, options: ScrapRequestOptions): IntegrationRow[] {
  if (options.itemId !== undefined) {
    const item = findCompanyItem(deps.db, companyId, options.itemId)
    const integration = item === undefined ? undefined : findIntegration(deps.db, companyId, item.integration_id)
    if (integration === undefined || integration.type !== service) throw invalidField('item_id', 'Unknown item for this service.')
    return [integration]
  }
  if (options.integrationId !== undefined) {
    const integration = findIntegration(deps.db, companyId, options.integrationId)
    if (integration === undefined || integration.type !== service) throw invalidField('integration_id', 'Unknown integration for this service.')
    return [integration]
  }
  return listIntegrations(deps.db, companyId, service).filter((row) => row.status === 'active')
}

function targetItems(deps: ServiceDeps, integration: IntegrationRow, itemId: string | null): (ItemRow | null)[] {
  const items = listItems(deps.db, integration.id).filter((item) => item.is_active === 1 && (itemId === null || item.id === itemId))
  return items.length === 0 ? (itemId === null ? [null] : []) : items
}
