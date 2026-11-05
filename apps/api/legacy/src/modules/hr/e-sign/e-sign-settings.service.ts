import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { HrError } from '../shared/hr-error'
import { commitHrFile, IMAGE_MIME_TYPES, prepareHrFile, readHrFile, type HrFileDownload, type HrUpload } from '../shared/hr-files'
import { BASE_TEMPLATES, findBaseTemplate } from './base-templates'
import {
  countActiveSeals,
  findSeal,
  findTemplateOverride,
  findUserEmail,
  insertSeal,
  listActiveSeals,
  listNotiRecipients,
  listTemplateOverrides,
  replaceNotiRecipients,
  saveTemplateOverride,
  softDeleteSeal,
} from './e-sign-settings.repository'
import type { CompanySealRow, NotiRecipientInput, NotiRecipientRow, ResolvedTemplate, TemplateBlock } from './e-sign.types'
import { mergeTemplate } from './e-sign.utils'

/** Most seals a company may keep (rule R27). */
export const MAX_COMPANY_SEALS = 5

/** Filters of the template list. */
export interface TemplateFilter {
  search?: string | undefined
  category?: string | undefined
  isActive?: boolean | undefined
  isCertificate?: boolean | undefined
}

/** A template edit. */
export interface TemplatePatch {
  title?: string | undefined
  body?: TemplateBlock[] | undefined
  field_defaults?: Record<string, string | number | null> | undefined
  is_active?: boolean | undefined
  default_seal?: number | null | undefined
}

/** Lists the company's view of every base template. */
export function listTemplates(db: DatabaseSync, companyId: string, filter: TemplateFilter): ResolvedTemplate[] {
  const overrides = new Map(listTemplateOverrides(db, companyId).map((row) => [row.template_id, row]))
  const search = filter.search?.trim() ?? ''
  return BASE_TEMPLATES.map((base) => mergeTemplate(base, overrides.get(base.id))).filter(
    (template) =>
      (search === '' || template.title.includes(search)) &&
      (filter.category === undefined || filter.category === '' || template.category === filter.category) &&
      (filter.isActive === undefined || template.is_active === filter.isActive) &&
      (filter.isCertificate === undefined || template.is_certificate === filter.isCertificate),
  )
}

/** Resolves one template for the company, or `undefined` when the ID is unknown. */
export function findTemplate(db: DatabaseSync, companyId: string, templateId: number): ResolvedTemplate | undefined {
  const base = findBaseTemplate(templateId)
  return base === undefined ? undefined : mergeTemplate(base, findTemplateOverride(db, companyId, templateId))
}

/**
 * Saves a company's edit of a template as an override (copy-on-write).
 *
 * @throws {DomainError} `NOT_FOUND` for unknown templates, `VALIDATION_FAILED` when the default seal is unknown or deleted or a field key is unknown.
 */
export function patchTemplate(deps: ServiceDeps, companyId: string, templateId: number, patch: TemplatePatch, userId: string): ResolvedTemplate {
  const base = findBaseTemplate(templateId)
  if (base === undefined) throw notFound('Template')
  for (const key of Object.keys(patch.field_defaults ?? {})) {
    if (!base.fields.some((field) => field.key === key)) throw invalidField(`field_defaults.${key}`, 'Unknown field.')
  }
  return transaction(deps.db, () => {
    if (patch.default_seal !== undefined && patch.default_seal !== null) requireActiveSeal(deps.db, companyId, patch.default_seal, 'default_seal')
    const current = findTemplateOverride(deps.db, companyId, templateId)
    const defaults = { ...(current?.field_defaults == null ? {} : (JSON.parse(current.field_defaults) as Record<string, unknown>)), ...patch.field_defaults }
    saveTemplateOverride(deps.db, {
      company_id: companyId,
      template_id: templateId,
      title: patch.title ?? current?.title ?? null,
      body: patch.body === undefined ? (current?.body ?? null) : JSON.stringify(patch.body),
      field_defaults: Object.keys(defaults).length === 0 ? null : JSON.stringify(defaults),
      is_active: patch.is_active === undefined ? (current?.is_active ?? 1) : patch.is_active ? 1 : 0,
      default_seal_id: patch.default_seal === undefined ? (current?.default_seal_id ?? null) : patch.default_seal,
      updated_by: findUserEmail(deps.db, userId),
      updated_at: deps.clock.now(),
    })
    return mergeTemplate(base, findTemplateOverride(deps.db, companyId, templateId))
  })
}

/** Lists the company's seals. */
export function listSeals(db: DatabaseSync, companyId: string): CompanySealRow[] {
  return listActiveSeals(db, companyId)
}

/**
 * Registers an uploaded or drawn seal image.
 *
 * @throws {HrError} `SEAL_LIMIT_EXCEEDED` when five seals already exist.
 */
export async function addSeal(deps: ServiceDeps, companyId: string, upload: HrUpload, userId: string): Promise<CompanySealRow> {
  if (countActiveSeals(deps.db, companyId) >= MAX_COMPANY_SEALS) throw sealLimit()
  const source = upload.fields['source'] === 'drawn' ? 'drawn' : 'upload'
  const prepared = await prepareHrFile(deps, companyId, upload, userId, IMAGE_MIME_TYPES)
  return commitHrFile(deps, prepared, (file) => {
    if (countActiveSeals(deps.db, companyId) >= MAX_COMPANY_SEALS) throw sealLimit()
    const id = insertSeal(deps.db, companyId, file.id, source, userId, deps.clock.now())
    return requireActiveSeal(deps.db, companyId, id, 'seal')
  })
}

/** Deletes a seal; documents already sent keep the image they were stamped with. */
export function removeSeal(deps: ServiceDeps, companyId: string, sealId: number): void {
  if (!transaction(deps.db, () => softDeleteSeal(deps.db, companyId, sealId, deps.clock.now()))) throw notFound('Seal')
}

/** Reads a seal's image. */
export async function readSealImage(deps: ServiceDeps, companyId: string, sealId: number): Promise<HrFileDownload> {
  const seal = findSeal(deps.db, companyId, sealId)
  if (seal === undefined || seal.deleted_at !== null) throw notFound('Seal')
  return readHrFile(deps, companyId, seal.file_id)
}

/**
 * Returns a seal that exists and has not been deleted.
 *
 * @throws {DomainError} `VALIDATION_FAILED` on `field` otherwise.
 */
export function requireActiveSeal(db: DatabaseSync, companyId: string, sealId: number, field: string): CompanySealRow {
  const seal = findSeal(db, companyId, sealId)
  if (seal === undefined || seal.deleted_at !== null) throw invalidField(field, 'Choose a registered seal.')
  return seal
}

/** Lists the e-sign notification recipients. */
export function getNotiRecipients(db: DatabaseSync, companyId: string): NotiRecipientRow[] {
  return listNotiRecipients(db, companyId)
}

/** Replaces the e-sign notification recipients (at most three, rule R26). */
export function putNotiRecipients(db: DatabaseSync, companyId: string, recipients: readonly NotiRecipientInput[]): NotiRecipientRow[] {
  return transaction(db, () => {
    recipients.forEach((recipient, index) => {
      if (recipient.position !== null && !positionExists(db, companyId, recipient.position)) throw invalidField(`${index}.position`, 'Unknown position.')
    })
    replaceNotiRecipients(db, companyId, recipients)
    return listNotiRecipients(db, companyId)
  })
}

function positionExists(db: DatabaseSync, companyId: string, positionId: number): boolean {
  return db.prepare('SELECT 1 FROM positions WHERE company_id = ? AND id = ?').get(companyId, positionId) !== undefined
}

function sealLimit(): HrError {
  return new HrError('SEAL_LIMIT_EXCEEDED', `A company can keep up to ${MAX_COMPANY_SEALS} seals.`)
}
