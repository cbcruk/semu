import type { ServiceDeps } from '../../../app.types'
import { execute, queryOne } from '../../../db/query'
import { DomainError, notFound } from '../../../lib/domain-error'
import type { PlatformDeps } from '../platform.types'
import { newId } from '../platform.utils'

/** Body of the consultation forms (`POST /public/api/consult`, `POST /api/company/:id/consult/`). */
export interface ConsultInput {
  name: string
  phone: string
  email: string
  company_name?: string | undefined
  business_number?: string | undefined
  legal_form?: number | undefined
  label_ids: number[]
  consulting_privacy_date: string
  consulting_third_party_date: string
  utm_source?: string | undefined
  utm_medium?: string | undefined
  utm_campaign?: string | undefined
  utm_content?: string | undefined
  memo?: string | undefined
}

/**
 * Records a consultation request and sends the AlimTalk receipt.
 *
 * Signed-in requests are tied to the company and user; public ones are not.
 */
export async function submitConsult(deps: PlatformDeps, input: ConsultInput, owner: { companyId: string; userId: string } | null): Promise<Record<string, unknown>> {
  const id = newId('lead')
  const now = deps.clock.now()
  execute(
    deps.db,
    `INSERT INTO consult_leads (id, company_id, user_id, name, phone, email, company_name, business_number, legal_form, label_ids, memo, privacy_agreed_on,
       third_party_agreed_on, utm_source, utm_medium, utm_campaign, utm_content, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    [
      id,
      owner?.companyId ?? null,
      owner?.userId ?? null,
      input.name,
      input.phone,
      input.email,
      input.company_name ?? null,
      input.business_number?.replace(/-/g, '') ?? null,
      input.legal_form ?? null,
      JSON.stringify(input.label_ids),
      input.memo ?? null,
      input.consulting_privacy_date,
      input.consulting_third_party_date,
      input.utm_source ?? null,
      input.utm_medium ?? null,
      input.utm_campaign ?? null,
      input.utm_content ?? null,
      now,
    ],
  )
  await deps.messenger.sendSms({ to: input.phone.replace(/\D/g, ''), template: 'consult_received', data: { name: input.name } })
  return { id, status: 'new', created_at: now }
}

/**
 * Creates an online lead keyed by the client's `timestamp`.
 *
 * @throws {DomainError} `CONFLICT` when a lead with the same timestamp exists.
 */
export function createOnlineLead(deps: ServiceDeps, timestamp: string, data: Record<string, unknown>): Record<string, unknown> {
  if (findLead(deps, timestamp) !== undefined) throw new DomainError('CONFLICT', 'A lead with this timestamp already exists.')
  const now = deps.clock.now()
  execute(deps.db, 'INSERT INTO online_leads (timestamp_key, data, created_at, updated_at) VALUES (?, ?, ?, ?)', [timestamp, JSON.stringify(data), now, now])
  return { timestamp, ...data }
}

/**
 * Merges fields into an online lead step by step.
 *
 * @throws {DomainError} `NOT_FOUND` for unknown timestamps.
 */
export function patchOnlineLead(deps: ServiceDeps, timestamp: string, data: Record<string, unknown>): Record<string, unknown> {
  const existing = findLead(deps, timestamp)
  if (existing === undefined) throw notFound('Lead')
  const merged = { ...(JSON.parse(existing.data) as Record<string, unknown>), ...data }
  execute(deps.db, 'UPDATE online_leads SET data = ?, updated_at = ? WHERE timestamp_key = ?', [JSON.stringify(merged), deps.clock.now(), timestamp])
  return { timestamp, ...merged }
}

function findLead(deps: ServiceDeps, timestamp: string): { data: string } | undefined {
  return queryOne<{ data: string }>(deps.db, 'SELECT data FROM online_leads WHERE timestamp_key = ?', [timestamp])
}
