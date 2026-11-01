import type { ServiceDeps } from '../../../app.types'
import { execute, queryOne } from '../../../db/query'
import { invalidField } from '../../../lib/domain-error'
import type { BusinessTypeEntry } from '../adapters/scraping.adapter'
import { findCompanyProfile, updateBusinessTypes } from '../company-profile/company-profile.repository'
import type { PlatformDeps } from '../platform.types'
import { isValidBusinessNumber, newId } from '../platform.utils'

/**
 * Looks up a counterparty's registration status at the tax office.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for malformed business numbers.
 */
export async function lookupBusinessStatus(deps: PlatformDeps, raw: string): Promise<Record<string, unknown>> {
  const digits = raw.replace(/-/g, '')
  if (!isValidBusinessNumber(digits)) throw invalidField('business_number', 'Enter a valid 10-digit business registration number.')
  const status = await deps.businessStatus.lookup(digits)
  return { business_number: digits, business_status: status.businessStatus, taxation_type: status.taxationType, closed_on: status.closedOn }
}

/** Sends the company's details to counterparties by mail and records the share. */
export async function shareCompany(
  deps: PlatformDeps,
  companyId: string,
  userId: string,
  input: { receivers: string[]; detail: Record<string, string | undefined>; representative_image_id?: string | null | undefined; bankbook_image_id?: string | null | undefined },
): Promise<Record<string, unknown>> {
  const company = findCompanyProfile(deps.db, companyId)
  const detail = Object.fromEntries(Object.entries(input.detail).filter(([, value]) => value !== undefined)) as Record<string, string>
  for (const receiver of input.receivers) {
    await deps.messenger.sendMail({ to: receiver, template: 'share_company', data: { company_name: company?.name ?? '', ...detail } })
  }
  const id = newId('share')
  const now = deps.clock.now()
  execute(
    deps.db,
    `INSERT INTO share_histories (id, company_id, receivers, detail, representative_image_id, bankbook_image_id, sent_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, companyId, JSON.stringify(input.receivers), JSON.stringify(detail), input.representative_image_id ?? null, input.bankbook_image_id ?? null, userId, now],
  )
  return { id, receivers: input.receivers, created_at: now }
}

/** Returns the most recent share so the form can be prefilled, or `null`. */
export function recentShare(deps: ServiceDeps, companyId: string): Record<string, unknown> | null {
  const row = queryOne<{ detail: string; representative_image_id: string | null; bankbook_image_id: string | null; created_at: string }>(
    deps.db,
    'SELECT detail, representative_image_id, bankbook_image_id, created_at FROM share_histories WHERE company_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    [companyId],
  )
  if (row === undefined) return null
  return {
    share_info: { detail: JSON.parse(row.detail) as unknown },
    representative_image: row.representative_image_id === null ? null : { id: row.representative_image_id },
    bankbook_image: row.bankbook_image_id === null ? null : { id: row.bankbook_image_id },
    created_at: row.created_at,
  }
}

/** Returns the business types last read from Hometax. */
export function getBusinessTypes(deps: ServiceDeps, companyId: string): Record<string, unknown>[] {
  const json = findCompanyProfile(deps.db, companyId)?.business_types ?? null
  const entries = json === null ? [] : (JSON.parse(json) as BusinessTypeEntry[])
  return entries.map(serializeBusinessType)
}

/** Re-reads the business types from Hometax and stores them for grant matching. */
export async function refreshBusinessTypes(deps: PlatformDeps, companyId: string): Promise<Record<string, unknown>[]> {
  const company = findCompanyProfile(deps.db, companyId)
  if (company === undefined) return []
  const entries = await deps.scraping.fetchBusinessTypes(company.business_number.replace(/-/g, ''))
  updateBusinessTypes(deps.db, companyId, JSON.stringify(entries), deps.clock.now())
  return entries.map(serializeBusinessType)
}

function serializeBusinessType(entry: BusinessTypeEntry): Record<string, unknown> {
  return { code: entry.code, business_type: entry.businessType, business_class: entry.businessClass, is_main: entry.isMain }
}
